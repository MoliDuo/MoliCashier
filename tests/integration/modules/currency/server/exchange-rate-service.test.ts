import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  ensureExchangeRates,
  refreshExchangeRates,
  spreadToCalendarDays,
} from "@/modules/currency/server/exchange-rates";
import { sourceDocuments } from "@/persistence";
import { exchangeRates } from "@/persistence/schema/currency";
import { getTestDb } from "tests/setup";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";

function providerResponse(rates: Record<string, Record<string, number>>, base = "EUR") {
  return { ok: true, json: async () => ({ base, rates }) } as Response;
}

async function storedDay(rateDate: string) {
  const rows = await getTestDb().query.exchangeRates.findMany({
    where: eq(exchangeRates.rateDate, rateDate),
  });
  return rows
    .map(({ currency, perEur, sourceDate }) => ({ currency, perEur, sourceDate }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

describe("spreadToCalendarDays", () => {
  it("carries the latest earlier publication onto days without one", () => {
    expect(
      spreadToCalendarDays({ "2024-01-19": { USD: 1.15 }, "2024-01-22": { USD: 1.2 } }, [
        "2024-01-22",
        "2024-01-20",
        "2024-01-18",
      ])
    ).toEqual([
      { rateDate: "2024-01-20", sourceDate: "2024-01-19", perEur: { USD: 1.15, EUR: 1 } },
      { rateDate: "2024-01-22", sourceDate: "2024-01-22", perEur: { USD: 1.2, EUR: 1 } },
    ]);
  });
});

describe("ensureExchangeRates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores a weekend day as one per-euro row per supported currency", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      providerResponse({ "2024-01-19": { USD: 1.15, CNY: 7.7, BGN: 1.9558 } })
    );

    await ensureExchangeRates(["2024-01-20"]);

    expect(await storedDay("2024-01-20")).toEqual([
      { currency: "CNY", perEur: "7.7", sourceDate: "2024-01-19" },
      { currency: "EUR", perEur: "1", sourceDate: "2024-01-19" },
      { currency: "USD", perEur: "1.15", sourceDate: "2024-01-19" },
    ]);
  });

  it("shares one provider request between identical requests made at the same time", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(providerResponse({ "2024-01-19": { USD: 1.15 } }));

    await Promise.all([
      ensureExchangeRates(["2024-01-20"]),
      ensureExchangeRates(["2024-01-20"]),
      ensureExchangeRates(["2024-01-20"]),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await storedDay("2024-01-20")).toHaveLength(2);

    // Once settled, a later request for a missing day asks again.
    await ensureExchangeRates(["2024-01-21"]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("asks the provider only for stored-less days up to today", async () => {
    await insertExchangeRates("2024-01-18", { USD: 1.1 });
    const fetchSpy = vi.spyOn(global, "fetch");
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    await ensureExchangeRates(["2024-01-18", future, null]);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches a day that is already today in a zone ahead of UTC", async () => {
    // 07:00 on 2 March in Shanghai is still 1 March in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-01T23:00:00.000Z") });
    try {
      vi.spyOn(global, "fetch").mockResolvedValue(providerResponse({ "2026-02-27": { USD: 1.1 } }));

      await ensureExchangeRates(["2026-03-02"]);

      expect(await storedDay("2026-03-02")).toContainEqual({
        currency: "USD",
        perEur: "1.1",
        sourceDate: "2026-02-27",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["an unavailable provider", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "an error status",
      () => Promise.resolve({ ok: false, status: 503, statusText: "Unavailable" } as Response),
    ],
    [
      "a base other than EUR",
      () => Promise.resolve(providerResponse({ "2024-01-22": { USD: 1.1 } }, "BGN")),
    ],
    ["a malformed day", () => Promise.resolve(providerResponse({ "not-a-date": { USD: 1.1 } }))],
    ["a negative rate", () => Promise.resolve(providerResponse({ "2024-01-22": { USD: -1.1 } }))],
    ["an invalid code", () => Promise.resolve(providerResponse({ "2024-01-22": { US: 1.1 } }))],
  ])("stores nothing and does not throw on %s", async (_label, respond) => {
    vi.spyOn(global, "fetch").mockImplementation(respond);

    await expect(ensureExchangeRates(["2024-01-22"])).resolves.toBeUndefined();
    expect(await storedDay("2024-01-22")).toEqual([]);
  });

  it("tells every ledger to refresh when a day's rates arrive", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const before = await db.query.ledgerSyncState.findFirst();

    await insertExchangeRates("2024-01-22", { USD: 1.1 });

    const after = await db.query.ledgerSyncState.findFirst();
    expect(after!.version).toBeGreaterThan(before?.version ?? BigInt(0));
  });
});

describe("refreshExchangeRates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills document days, replaces provisional days, and keeps final ones", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await db.insert(sourceDocuments).values({
      documentDate: "2024-03-05",
      bookId: await testBookId(db),
    });
    await insertExchangeRates(
      "2024-03-02",
      { USD: 1.05 },
      { sourceDate: "2024-03-01", fetchedAt: new Date("2024-03-02T12:00:00.000Z") }
    );
    await insertExchangeRates("2024-03-01", { USD: 1.01 });
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      providerResponse({
        "2024-03-01": { USD: 1.09 },
        "2024-03-04": { USD: 1.08 },
        "2024-03-05": { USD: 1.07 },
      })
    );
    const now = new Date("2024-03-10T00:00:00.000Z");

    await refreshExchangeRates(now);

    expect(await storedDay("2024-03-05")).toContainEqual({
      currency: "USD",
      perEur: "1.07",
      sourceDate: "2024-03-05",
    });
    expect(await storedDay("2024-03-02")).toContainEqual({
      currency: "USD",
      perEur: "1.09",
      sourceDate: "2024-03-01",
    });
    expect(await storedDay("2024-03-01")).toContainEqual({
      currency: "USD",
      perEur: "1.01",
      sourceDate: "2024-03-01",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await db.insert(sourceDocuments).values({
      documentDate: "2024-03-06",
      bookId: await testBookId(db),
    });
    await refreshExchangeRates(new Date(now.getTime() + 5 * 60_000));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("converts entries of a day once refresh fills its rates", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const [document] = await db
      .insert(sourceDocuments)
      .values({ documentDate: "2024-03-05", bookId: await testBookId(db) })
      .returning();
    vi.spyOn(global, "fetch").mockResolvedValue(
      providerResponse({ "2024-03-05": { USD: 1.25, CNY: 7.5 } })
    );
    const convert = () =>
      db.execute<{ converted: string | null }>(sql`
        SELECT convert_amount(10, 'USD', 'CNY', document_date)::text AS converted
        FROM source_documents WHERE id = ${document!.id}
      `);

    expect((await convert()).rows[0]?.converted).toBeNull();
    await refreshExchangeRates(new Date("2024-03-10T00:00:00.000Z"));
    expect((await convert()).rows[0]?.converted).toBe("60.00");
    expect(
      await db.query.exchangeRates.findFirst({
        where: and(eq(exchangeRates.rateDate, "2024-03-05"), eq(exchangeRates.currency, "EUR")),
      })
    ).toBeDefined();
  });
});
