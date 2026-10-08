import { describe, expect, it } from "vitest";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import { filterStreamEntries } from "@/modules/source-document/stream-filter-policy";

function makeItem(overrides: Partial<SourceDocumentListItemDto> = {}): SourceDocumentListItemDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    latestAttemptId: null,
    title: "Coffee receipt",
    text: null,
    processingStatus: "completed",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-08-05",
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    hasImages: false,
    pendingSuggestions: [],
    supportedActions: [],
    canEdit: false,
    errorCode: null,
    ledgerEntries: [],
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<NonNullable<SourceDocumentListItemDto["ledgerEntries"]>[number]> = {}
) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    categoryId: null,
    sourceDocumentId: "00000000-0000-4000-8000-000000000001",
    amount: "50.00",
    currency: "USD",
    itemName: "Latte",
    description: "Morning coffee",
    convertedAmount: "50.00",
    exchangeRate: "1.000000",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    category: null,
    ...overrides,
  };
}

describe("stream filter policy", () => {
  it("matches search only against entry name and description", () => {
    const entries = [makeEntry({ itemName: "Tea", description: "Afternoon drink" })];

    expect(filterStreamEntries(entries, { search: "coffee" })).toHaveLength(0);
    expect(filterStreamEntries(entries, { search: "afternoon" })).toHaveLength(1);
  });

  it("requires one entry to satisfy all amount bounds", () => {
    const entries = [
      makeEntry({ id: "00000000-0000-4000-8000-000000000004", convertedAmount: "5.00" }),
      makeEntry({ id: "00000000-0000-4000-8000-000000000005", convertedAmount: "100.00" }),
    ];

    expect(filterStreamEntries(entries, { minAmount: "10", maxAmount: "90" })).toHaveLength(0);
  });

  it("does not match amount windows with unconverted entries", () => {
    const entries = [makeEntry({ amount: "1.00", convertedAmount: null })];

    expect(filterStreamEntries(entries, { minAmount: "1" })).toHaveLength(0);
  });

  it("keeps every entry when nothing narrows them, without changing the input", () => {
    const item = makeItem({
      ledgerEntries: [
        makeEntry({ itemName: "Latte" }),
        makeEntry({ id: "00000000-0000-4000-8000-000000000006", itemName: "Cake" }),
      ],
    });

    expect(filterStreamEntries(item.ledgerEntries, {})).toHaveLength(2);
    expect(filterStreamEntries(item.ledgerEntries, { search: "latte" })).toHaveLength(1);
    expect(item.ledgerEntries).toHaveLength(2);
  });
});
