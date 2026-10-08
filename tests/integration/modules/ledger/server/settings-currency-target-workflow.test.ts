import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateLedgerSettings } from "@/modules/ledger/server/settings";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { exchangeRates } from "@/persistence/schema/currency";
import {
  createTestLedger,
  testBookId,
  createTestRecord,
  todayUtc,
} from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";

describe("target Settings currency workflow", () => {
  let sourceDocumentId: string;

  async function createEntry() {
    const result = await createTestRecord(getTestDb(), {
      entryDate: "2026-07-15",
      entries: [
        {
          id: crypto.randomUUID(),
          categoryId: null,
          amount: "80.00",
          currency: "CNY",
          itemName: "Atomic currency entry",
          description: null,
        },
      ],
      bookId: await testBookId(getTestDb()),
    });
    sourceDocumentId = result.sourceDocumentId;
  }

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
    await db.update(ledgers).set({ preferredCurrencies: ["CNY", "USD"] });
    await insertExchangeRates("2026-07-15", { CNY: 8, USD: 1 });
  });

  it("allows main currency change on empty ledger", async () => {
    const updated = await updateLedgerSettings({
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("changes main currency without rewriting entries, which then read in the new currency", async () => {
    await createEntry();

    const before = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });

    const updated = await updateLedgerSettings({
      settings: { mainCurrency: "USD" },
    });
    const [entry, document, stats] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst(),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
      calculateLedgerStats({}),
    ]);

    expect(updated.settings.mainCurrency).toBe("USD");
    expect(entry).toMatchObject({ amount: "80.000", currency: "CNY" });
    expect(document?.version).toBe(before!.version);
    expect(stats.convertedTotal).toEqual({ total: "10", currency: "USD" });
    expect(stats.unconvertedCount).toBe(0);
  });

  it("allows other setting changes when entries exist", async () => {
    await createEntry();

    const updated = await updateLedgerSettings({
      settings: { aiLanguage: "en" },
    });
    expect(updated.settings.aiLanguage).toBe("en");
    expect(updated.settings.mainCurrency).toBe("CNY");
  });

  it("allows main currency change after the source document is deleted", async () => {
    await createEntry();

    const db = getTestDb();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocumentId));

    const updated = await updateLedgerSettings({
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("rejects an unsupported main currency and keeps the settings", async () => {
    await createEntry();

    await expect(updateLedgerSettings({ settings: { mainCurrency: "ZZZ" } })).rejects.toThrow(
      "Currency not found: ZZZ"
    );

    const ledger = await getTestDb().query.ledgers.findFirst();
    expect(ledger?.mainCurrency).toBe("CNY");
  });

  it("keeps a stored currency that has left the supported list", async () => {
    // A ledger set up while BHD was still offered.
    await getTestDb()
      .update(ledgers)
      .set({ mainCurrency: "BHD", preferredCurrencies: ["BHD", "CNY"] });

    await updateLedgerSettings({ settings: { collapseEntriesDefault: true } });
    await updateLedgerSettings({ settings: { currencies: ["BHD", "CNY", "USD"] } });

    const ledger = await getTestDb().query.ledgers.findFirst();
    expect(ledger).toMatchObject({
      mainCurrency: "BHD",
      preferredCurrencies: ["BHD", "CNY", "USD"],
    });
    // It can be kept, never newly chosen.
    await expect(
      updateLedgerSettings({ settings: { currencies: ["BHD", "CNY", "USD", "KWD"] } })
    ).rejects.toThrow("Currency not found: KWD");
  });

  describe("historical rate gaps", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Inserts a second main-currency entry dated `entryDate`, a day with no stored rates. */
    async function addMainCurrencyOnlyEntry(entryDate: string) {
      const db = getTestDb();
      const sourceDocumentId = crypto.randomUUID();
      await db.insert(sourceDocuments).values({
        id: sourceDocumentId,
        documentDate: entryDate,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      });
      await db.insert(ledgerEntries).values({
        sourceDocumentId,
        amount: "40.00",
        currency: "CNY",
        itemName: "Main-currency-only entry",
      });
    }

    it("fetches the rates of a day that has none when the main currency changes", async () => {
      await createEntry();
      await addMainCurrencyOnlyEntry("2026-07-14");
      const db = getTestDb();

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ base: "EUR", rates: { "2026-07-14": { CNY: 8, USD: 1 } } }),
      } as Response);

      const updated = await updateLedgerSettings({
        settings: { mainCurrency: "USD" },
      });

      expect(updated.settings.mainCurrency).toBe("USD");
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("..2026-07-14"),
        expect.anything()
      );
      expect(
        await db.query.exchangeRates.findFirst({
          where: and(eq(exchangeRates.rateDate, "2026-07-14"), eq(exchangeRates.currency, "CNY")),
        })
      ).toMatchObject({ rateDate: "2026-07-14", currency: "CNY", perEur: "8" });
      expect((await calculateLedgerStats({})).convertedTotal).toEqual({
        total: "15",
        currency: "USD",
      });
    });

    it("keeps the main-currency change when the provider has no rate for a day", async () => {
      await createEntry();
      // Before the ECB reference series' earliest date.
      await addMainCurrencyOnlyEntry("1990-01-01");

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response);

      const updated = await updateLedgerSettings({ settings: { mainCurrency: "USD" } });

      expect(updated.settings.mainCurrency).toBe("USD");
      const stats = await calculateLedgerStats({});
      expect(stats.convertedTotal).toEqual({ total: "10", currency: "USD" });
      expect(stats.unconvertedCount).toBe(1);
    });
  });

  it("keeps both of two concurrent writes to different settings", async () => {
    const results = await Promise.allSettled([
      updateLedgerSettings({ settings: { collapseEntriesDefault: true } }),
      updateLedgerSettings({ settings: { timeZone: "Asia/Tokyo" } }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const saved = await getTestDb().query.ledgers.findFirst();
    expect(saved?.collapseEntriesDefault).toBe(true);
    expect(saved?.timeZone).toBe("Asia/Tokyo");
  });
});

describe("settings concurrency invariants", () => {
  it("concurrent main-currency change and first activateAttempt are serialised by the ledger lock", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    for (let i = 0; i < 5; i++) {
      // Create a pending attempt first (this creates the document but not the active projection).
      const sourceDocumentId = crypto.randomUUID();
      await db
        .insert(sourceDocuments)
        .values({
          documentDate: todayUtc(),
          id: sourceDocumentId,
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const { attempt } = await db.transaction(async (tx) => {
        const { createProcessingAttemptInTransaction: createProcessingAttempt } =
          await import("@/modules/source-document/server/extraction-attempts");
        return createProcessingAttempt(tx, {
          sourceDocumentId,
          input: { text: "Race test", storedFileIds: [], documentDate: null },
        });
      });

      const lease = await claimAttemptForTest(attempt.id);

      // Run main-currency change and activateAttempt concurrently.
      const results = await Promise.allSettled([
        updateLedgerSettings({ settings: { mainCurrency: "USD" } }),
        activateAttempt({
          lease,
          sourceDocumentId,
          attemptId: attempt.id,
          entries: [
            {
              categoryId: null,
              amount: "80.00",
              currency: "CNY",
              itemName: "Race entry",
              description: null,
            },
          ],
        }),
      ]);

      // The lock serialises the two operations — no deadlock, no partial state.
      const ledger = await db.query.ledgers.findFirst();
      const activeEntries = await db.query.ledgerEntries.findMany();
      expect(ledger).not.toBeNull();

      // Verify main-currency/entry consistency invariant.
      const [settingsResult, activateResult] = results;
      const mainCurrency = ledger?.mainCurrency;

      if (activateResult.status === "fulfilled" && activateResult.value === true) {
        // activateAttempt succeeded — entries were created.
        if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
          // Settings succeeded: must have run before activate, so mainCurrency is "USD"
          expect(mainCurrency).toBe("USD");
          expect(activeEntries.length).toBeGreaterThan(0);
          expect(activeEntries.every((e) => e.currency === "CNY")).toBe(true);
        } else {
          // Settings was rejected: entries existed first, mainCurrency unchanged.
          expect(mainCurrency).toBe("CNY");
          expect(activeEntries.length).toBeGreaterThan(0);
        }
      } else if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        // Only settings succeeded — no entries created.
        expect(mainCurrency).toBe("USD");
        expect(activeEntries).toHaveLength(0);
      }

      // Clean up
      if (activateResult.status === "fulfilled" && activateResult.value === true) {
        // Deleting the documents takes their entries with them.
        await db.delete(sourceDocuments);
      }
      if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        await db.update(ledgers).set({ mainCurrency: "CNY" });
      }
    }
  });
});
