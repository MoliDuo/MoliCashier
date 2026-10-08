import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import type { Period } from "@/modules/ledger/domain/period";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";
import {
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";

const MARCH: Period = { range: "custom", from: "2026-03-01", to: "2026-03-31" };
const THIS_MONTH: Period = { range: "month", offset: 0 };

describe("ledger tab query descriptors", () => {
  it("sends the period itself, never its days, and keys it the same way", () => {
    const descriptor = buildStreamQueryDescriptor({ period: MARCH, search: "  coffee  " });

    expect(descriptor.getPageInput()).toEqual({ period: MARCH, search: "coffee", limit: 20 });
    expect(descriptor.totalInput).toEqual({ period: MARCH, search: "coffee" });
    const keyFilters = {
      bookId: null,
      period: "custom:2026-03-01:2026-03-31",
      minAmount: null,
      maxAmount: null,
      statuses: null,
      search: "coffee",
      categoryId: null,
      currency: null,
    };
    expect(descriptor.queryKey).toEqual(queryKeys.sourceDocumentStream(keyFilters));
    expect(descriptor.totalQueryKey).toEqual(queryKeys.sourceDocumentStreamTotal(keyFilters));
  });

  it("keys this month by its name, so a prefetch and the tab agree at any hour", () => {
    const first = buildStreamQueryDescriptor({ period: THIS_MONTH });
    const second = buildStreamQueryDescriptor({ period: { range: "month", offset: 0 } });
    expect(first.queryKey).toEqual(second.queryKey);
    expect(first.queryKey).not.toEqual(
      buildStreamQueryDescriptor({ period: { range: "month", offset: -1 } }).queryKey
    );
  });

  it("keeps details search filters in both summary and entries requests", () => {
    const descriptor = buildDetailsQueryDescriptor({
      period: MARCH,
      advancedFilters: { search: "  coffee " },
      mainCurrency: "USD",
    });

    expect(descriptor.summaryInput).toEqual({ period: MARCH, search: "coffee" });
    expect(descriptor.getEntriesInput()).toEqual({ period: MARCH, search: "coffee", limit: 50 });
    expect(descriptor.summaryQueryKey).toEqual(
      queryKeys.summary({
        bookId: null,
        period: "custom:2026-03-01:2026-03-31",
        currency: "USD",
        filter: "search:coffee",
      })
    );
    expect(descriptor.entriesQueryKey).toEqual(
      queryKeys.ledgerEntries({
        bookId: null,
        mode: "infinite",
        period: "custom:2026-03-01:2026-03-31",
        filter: "search:coffee",
      })
    );
  });

  it("scopes details requests and cache keys to the selected book", () => {
    const input = { period: MARCH, mainCurrency: "USD" };
    const mine = buildDetailsQueryDescriptor({ ...input, bookId: "book-1" });
    const partner = buildDetailsQueryDescriptor({ ...input, bookId: "book-2" });
    expect(mine.getEntriesInput()).toEqual(expect.objectContaining({ bookId: "book-1" }));
    expect(mine.summaryInput.bookId).toBe("book-1");
    expect(mine.entriesQueryKey).not.toEqual(partner.entriesQueryKey);
    expect(mine.summaryQueryKey).not.toEqual(partner.summaryQueryKey);
  });

  it("hands 统计 the period and keys it by the period and currency", () => {
    const descriptor = buildStatsQueryDescriptor({
      period: { range: "week", offset: -1 },
      mainCurrency: "USD",
    });

    expect(descriptor.input).toEqual({ period: { range: "week", offset: -1 } });
    expect(descriptor.queryKey).toEqual(
      queryKeys.enhancedStats({ bookId: null, period: "week:-1", mainCurrency: "USD" })
    );
    expect(descriptor.forecastQueryKey).toEqual(
      queryKeys.forecast({ bookId: null, period: "week:-1", mainCurrency: "USD" })
    );
  });

  it("omits amount filters the reader cleared from the stream requests", () => {
    const descriptor = buildStreamQueryDescriptor({
      period: THIS_MONTH,
      minAmount: null,
      maxAmount: null,
      statuses: [],
    });

    expect(descriptor.getPageInput()).toEqual({ period: THIS_MONTH, limit: 20 });
    expect(descriptor.totalInput).toEqual({ period: THIS_MONTH });
  });

  it("canonicalizes the status ordering once, for both requests and keys", () => {
    const descriptor = buildStreamQueryDescriptor({
      period: THIS_MONTH,
      minAmount: "10",
      maxAmount: "20",
      statuses: ["failed", "cancelled", "failed"],
    });

    expect(descriptor.getPageInput()).toEqual({
      period: THIS_MONTH,
      minAmount: "10",
      maxAmount: "20",
      statuses: ["cancelled", "failed"],
      limit: 20,
    });
    const keyFilters = {
      bookId: null,
      period: "month:0",
      minAmount: "10",
      maxAmount: "20",
      statuses: "cancelled,failed",
      search: null,
      categoryId: null,
      currency: null,
    };
    expect(descriptor.queryKey).toEqual(queryKeys.sourceDocumentStream(keyFilters));
    expect(descriptor.totalQueryKey).toEqual(queryKeys.sourceDocumentStreamTotal(keyFilters));
  });

  it("keys and sends a bill list's category and currency", () => {
    const descriptor = buildStreamQueryDescriptor({
      period: { range: "month", offset: 0 },
      categoryId: "__uncategorized__",
      currency: "USD",
    });
    expect(descriptor.totalInput).toMatchObject({
      categoryId: "__uncategorized__",
      currency: "USD",
    });
    expect(descriptor.queryKey.at(-1)).toMatchObject({
      categoryId: "__uncategorized__",
      currency: "USD",
    });
  });
});
