import { describe, expect, it } from "vitest";

import type { EntryCategoryDto, LedgerEntryDto } from "@/modules/ledger/contracts";
import { calculateSourceDocumentCardTotal } from "@/modules/source-document/ui/source-document-card.utils";

const defaultCategory: EntryCategoryDto = {
  id: "cat-food",
  name: "餐饮",
  description: null,
  icon: "Utensils",
  sortOrder: 1,
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

function createEntry(overrides: Partial<LedgerEntryDto> = {}): LedgerEntryDto {
  return {
    id: "entry-1",
    categoryId: defaultCategory.id,
    category: defaultCategory,
    itemName: "默认条目",
    amount: "12.00",
    currency: "CNY",
    convertedAmount: null,
    exchangeRate: null,
    description: null,
    sourceDocumentId: "doc-1",
    sourceDocument: null,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

describe("source-document-card utils", () => {
  it("totals converted amounts and falls back to main-currency entry amounts", () => {
    const total = calculateSourceDocumentCardTotal(
      [
        createEntry({
          id: "usd-entry",
          amount: "10.00",
          currency: "USD",
          convertedAmount: "70.00",
        }),
        createEntry({
          id: "cny-entry",
          amount: "20.00",
          currency: "CNY",
          convertedAmount: null,
        }),
        // A foreign amount with no conversion contributes nothing.
        createEntry({
          id: "sgd-entry",
          amount: "5.00",
          currency: "SGD",
          convertedAmount: null,
        }),
      ],
      "CNY"
    );

    expect(total).toBe("90");
  });
});
