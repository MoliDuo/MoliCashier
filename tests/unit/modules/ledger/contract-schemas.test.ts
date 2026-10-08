import { describe, expect, it } from "vitest";
import {
  ledgerStatsQuerySchema,
  parseBatchUpdateLedgerEntriesInput,
  parseCreateLedgerEntryInput,
  parseListLedgerEntriesInput,
  periodInputSchema,
} from "@/modules/ledger/contract-schemas";
import { addCivilDays, MAX_PERIOD_DAYS } from "@/modules/ledger/domain/period";

describe("search param validation", () => {
  it("normalizes search in listLedgerEntriesInputSchema", () => {
    expect(parseListLedgerEntriesInput({ search: "  coffee   receipt " }).search).toBe(
      "coffee receipt"
    );
  });

  it("normalizes search in ledgerStatsQuerySchema", () => {
    expect(ledgerStatsQuerySchema.parse({ search: " grocery " }).search).toBe("grocery");
  });

  it("continues to accept supported filter params", () => {
    const entries = parseListLedgerEntriesInput({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      limit: "20",
    });

    expect(entries).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
      minAmount: "10",
      maxAmount: "50",
      limit: 20,
    });

    expect(
      ledgerStatsQuerySchema.parse({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        categoryId: "11111111-1111-4111-8111-111111111111",
        currency: "USD",
      })
    ).toMatchObject({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: "11111111-1111-4111-8111-111111111111",
      currency: "USD",
    });
  });

  it("accepts the uncategorized sentinel but rejects other non-UUID categories", () => {
    expect(parseListLedgerEntriesInput({ categoryId: "__uncategorized__" }).categoryId).toBe(
      "__uncategorized__"
    );
    expect(() => parseListLedgerEntriesInput({ categoryId: "not-a-category" })).toThrow();
  });

  it("preserves decimal precision and normalizes currency", () => {
    expect(
      parseListLedgerEntriesInput({
        currency: " usd ",
        minAmount: "9007199254740993.00",
        maxAmount: "9007199254740993.50",
      })
    ).toMatchObject({
      currency: "USD",
      minAmount: "9007199254740993",
      maxAmount: "9007199254740993.5",
    });
  });

  it("rejects reversed ranges and unknown fields while accepting signed amount filters", () => {
    expect(() =>
      parseListLedgerEntriesInput({ startDate: "2026-04-01", endDate: "2026-03-01" })
    ).toThrow();
    expect(() => ledgerStatsQuerySchema.parse({ minAmount: "20", maxAmount: "10" })).toThrow();
    expect(ledgerStatsQuerySchema.parse({ minAmount: "-1" })).toMatchObject({ minAmount: "-1" });
    expect(() => ledgerStatsQuerySchema.parse({ mainCurrency: "USD" })).toThrow();
  });
});

describe("entry write validation", () => {
  const sourceDocumentId = "00000000-0000-4000-8000-000000000001";

  it("only writes currencies the rates provider publishes", () => {
    expect(
      parseCreateLedgerEntryInput({
        sourceDocumentId,
        amount: "1",
        currency: " jpy ",
        itemName: "Tea",
      })
    ).toMatchObject({ currency: "JPY" });
    expect(() =>
      parseCreateLedgerEntryInput({
        sourceDocumentId,
        amount: "1",
        currency: "BHD",
        itemName: "Tea",
      })
    ).toThrow();
    expect(() => parseBatchUpdateLedgerEntriesInput({ currency: "KWD" })).toThrow();
    // A filter still finds rows written before a currency left the list.
    expect(parseListLedgerEntriesInput({ currency: "BHD" }).currency).toBe("BHD");
  });

  it("refuses an amount with more integer digits than the column holds", () => {
    const largest = "9".repeat(18);
    expect(
      parseCreateLedgerEntryInput({ sourceDocumentId, amount: `${largest}.99`, itemName: "Car" })
    ).toMatchObject({ amount: `${largest}.99` });
    expect(() =>
      parseCreateLedgerEntryInput({ sourceDocumentId, amount: `1${largest}`, itemName: "Car" })
    ).toThrow();
    expect(() => parseBatchUpdateLedgerEntriesInput({ amount: `-1${largest}` })).toThrow();
    expect(parseBatchUpdateLedgerEntriesInput({ amount: `-${largest}` })).toMatchObject({
      amount: `-${largest}`,
    });
  });
});

describe("periodInputSchema", () => {
  it("accepts a custom period of at most the longest span one read may cover", () => {
    const to = "2026-09-30";
    const longest = { range: "custom", from: addCivilDays(to, -(MAX_PERIOD_DAYS - 1)), to };
    expect(periodInputSchema.safeParse(longest).success).toBe(true);

    const result = periodInputSchema.safeParse({
      ...longest,
      from: addCivilDays(longest.from, -1),
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues).toEqual([
      expect.objectContaining({
        path: ["from"],
        message: `A period can cover at most ${MAX_PERIOD_DAYS} days`,
      }),
    ]);
  });
});
