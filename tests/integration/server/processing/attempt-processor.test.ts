import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { createPendingAttempt, claimAttemptForTest } from "tests/helpers/processing-attempt";
import { attemptProcessor } from "tests/helpers/processing-jobs";
import { fakeAiTransport, generateVia } from "tests/helpers/fake-ai";
import { ledgerEntries, ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";

type ModelEntry = {
  item_name: string;
  amount: string;
  currency: string;
  already_recorded?: string | null;
};

function modelReply(
  reply:
    { outcome: "success"; entries: ModelEntry[] } | { outcome: "invalid"; invalid_reason: string }
) {
  const entries = reply.outcome === "success" ? reply.entries : [];
  return JSON.stringify({
    outcome: reply.outcome,
    invalid_reason: reply.outcome === "invalid" ? reply.invalid_reason : null,
    title: "Receipt",
    receipt_count: entries.length === 0 ? 0 : 1,
    receipt_totals: entries.map((entry) => ({
      receipt_index: 0,
      amount: entry.amount,
      currency: entry.currency,
    })),
    ledger_entries: entries.map((entry) => ({
      receipt_index: 0,
      category_index: 0,
      notes: null,
      ...entry,
    })),
    order_adjustments: [],
    reasoning: "test",
  });
}

describe("processAttempt", () => {
  let ensureRates: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
    // The day's rates come from the network; here only the day asked for matters.
    ensureRates = vi.spyOn(exchangeRates, "ensureExchangeRates").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function process(content: string, documentDate: string | null = "2026-09-01") {
    const db = getTestDb();
    const pending = await createPendingAttempt({
      input: { text: "receipt", storedFileIds: [], documentDate },
      bookId: await testBookId(db),
    });
    const sourceDocumentId = pending.document.id;
    const attemptId = pending.attempt.id;
    // Late on the 30th in UTC, already the 31st further east.
    await db
      .update(sourceDocuments)
      .set({ createdAt: new Date("2026-08-30T23:30:00Z") })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    const lease = await claimAttemptForTest(attemptId);
    const transport = fakeAiTransport(() => content);
    const generate = generateVia(transport);

    const outcome = await attemptProcessor(generate).process({
      signal: new AbortController().signal,
      sourceDocumentId,
      attemptId,
      lease,
    });
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, attemptId),
    });
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    return { outcome, attempt, entries, transport, sourceDocumentId };
  }

  it("records the AI's trimmed reason when it declares the document invalid", async () => {
    const { outcome, attempt, entries } = await process(
      modelReply({ outcome: "invalid", invalid_reason: "  This is a refund, not an expense. " })
    );

    expect(outcome).toEqual({
      processingStatus: "failed",
      failureMessage: "This is a refund, not an expense.",
    });
    expect(attempt).toMatchObject({
      status: "failed",
      failureKind: "invalid_input",
      failureCode: "ai_declared_invalid",
      failureMessage: "This is a refund, not an expense.",
    });
    expect(entries).toEqual([]);
    expect(ensureRates).not.toHaveBeenCalled();
  });

  it("keeps only the diagnostic when the parsed entries fail validation", async () => {
    // Positive as written, but nothing once rounded to the currency's cents.
    const { outcome, attempt, entries } = await process(
      modelReply({
        outcome: "success",
        entries: [{ item_name: "Rounding", amount: "0.001", currency: "EUR" }],
      })
    );

    expect(outcome).toEqual({ processingStatus: "failed" });
    expect(attempt).toMatchObject({
      status: "failed",
      failureKind: "invalid_input",
      failureCode: "entry_validation_failed",
      failureMessage: null,
    });
    expect(entries).toEqual([]);
  });

  it("stores foreign amounts as written and caches the document day's rates once", async () => {
    const { outcome, attempt, entries } = await process(
      modelReply({
        outcome: "success",
        entries: [
          { item_name: "Croissant", amount: "10", currency: "EUR" },
          { item_name: "Coffee", amount: "3.5", currency: "EUR" },
        ],
      })
    );

    expect(outcome).toEqual({ processingStatus: "completed" });
    expect(attempt?.status).toBe("completed");
    expect(entries.map(({ amount, currency }) => ({ amount, currency }))).toEqual(
      expect.arrayContaining([
        { amount: "10.000", currency: "EUR" },
        { amount: "3.500", currency: "EUR" },
      ])
    );
    expect(ensureRates).toHaveBeenCalledTimes(1);
    expect(ensureRates).toHaveBeenCalledWith(["2026-09-01"]);
  });

  it("asks for the record's own day's rates when the submission carries no date", async () => {
    const { attempt } = await process(
      modelReply({
        outcome: "success",
        entries: [{ item_name: "Croissant", amount: "10", currency: "EUR" }],
      }),
      null
    );
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, attempt!.sourceDocumentId),
    });

    expect(document?.documentDate).not.toBeNull();
    expect(attempt?.requestedDate).toBe(document?.documentDate);
    expect(ensureRates).toHaveBeenCalledWith([document?.documentDate]);
  });

  describe("rows the ledger already holds", () => {
    async function recordEarlierUpload() {
      const db = getTestDb();
      return createTestRecord(db, {
        bookId: await testBookId(db),
        title: "Taobao orders",
        entryDate: "2026-08-31",
        entries: [
          {
            categoryId: null,
            amount: "19.90",
            currency: "CNY",
            itemName: "Data cable",
            description: null,
          },
          {
            categoryId: null,
            amount: "5.00",
            currency: "CNY",
            itemName: "Phone case",
            description: null,
          },
        ],
      });
    }

    const overlappingReply = (alreadyRecorded: string | null) =>
      modelReply({
        outcome: "success",
        entries: [
          {
            item_name: "Data cable",
            amount: "19.90",
            currency: "CNY",
            already_recorded: alreadyRecorded,
          },
          { item_name: "Desk lamp", amount: "42.00", currency: "CNY", already_recorded: null },
        ],
      });

    it("shows the model the entries recorded lately and keeps every row it returns", async () => {
      await recordEarlierUpload();

      const { entries, transport } = await process(overlappingReply("R1"));

      expect(transport.complete.mock.calls[0]?.[0].system).toContain(
        "R1 | 2026-08-31 | Taobao orders | Data cable | 19.900 CNY"
      );
      expect(entries.map((entry) => entry.itemName).sort()).toEqual(["Data cable", "Desk lamp"]);
    });

    it("records a suggestion that points the repeated row at the entry it repeats", async () => {
      const earlier = await recordEarlierUpload();
      const earlierCable = await getTestDb().query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.sourceDocumentId, earlier.sourceDocumentId),
        orderBy: (row, { asc }) => [asc(row.position)],
      });

      const { entries, sourceDocumentId } = await process(overlappingReply("R1"));

      const document = await getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      });
      const cable = entries.find((entry) => entry.itemName === "Data cable");
      expect(document?.duplicateSuggestion).toMatchObject({
        schemaVersion: 1,
        items: [
          {
            ledgerEntryId: cable?.id,
            snapshot: { itemName: "Data cable", currency: "CNY" },
            matched: {
              ledgerEntryId: earlierCable?.id,
              sourceDocumentId: earlier.sourceDocumentId,
            },
          },
        ],
      });
      expect(document?.duplicateSuggestion?.items).toHaveLength(1);
    });

    it("records nothing for a handle the model was not given or for a null", async () => {
      await recordEarlierUpload();

      for (const reply of ["R99", null]) {
        const { sourceDocumentId } = await process(overlappingReply(reply));
        const document = await getTestDb().query.sourceDocuments.findFirst({
          where: eq(sourceDocuments.id, sourceDocumentId),
        });
        expect(document?.duplicateSuggestion).toBeNull();
      }
    });

    it("leaves the section out and suggests nothing when nothing was recorded lately", async () => {
      const { transport, sourceDocumentId } = await process(overlappingReply("R1"));

      expect(transport.complete.mock.calls[0]?.[0].system).not.toContain(
        "### Recently Recorded Entries"
      );
      const document = await getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      });
      expect(document?.duplicateSuggestion).toBeNull();
    });
  });
});
