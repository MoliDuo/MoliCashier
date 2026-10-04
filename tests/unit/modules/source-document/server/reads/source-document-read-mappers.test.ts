import { describe, expect, it } from "vitest";
import {
  mapListItem,
  mapSourceDocumentDetail,
  type SourceDocumentRow,
  type SourceDocumentHydrationRow,
} from "@/modules/source-document/server/reads/mappers";

const row: SourceDocumentRow = {
  id: "doc",
  title: null,
  bookId: "book",
  documentDate: "2026-09-24",
  latestAttemptId: "retry",
  version: 3,
  createdAt: new Date("2026-09-24"),
  updatedAt: new Date("2026-09-24"),
  dateOrganizationSuggestion: null,
  duplicateSuggestion: null,
};
const hydration: SourceDocumentHydrationRow = {
  inputText: "retry",
  processingStatus: "failed",
  failureKind: "processing_error",
  failureMessage: null,
  failureCode: "storage_failure",
  hasImages: false,
  pendingSuggestions: [],
  duplicateSuggestion: null,
  files: [],
  mainCurrency: "KWD",
  ledgerEntries: [
    {
      id: "entry",
      categoryId: null,
      sourceDocumentId: "doc",
      amount: "100",
      currency: "USD",
      itemName: "Meal",
      description: null,
      convertedAmount: "1.234",
      exchangeRate: "0.01234",
      createdAt: "2026-09-24",
      updatedAt: "2026-09-24",
      category: null,
    },
  ],
};

describe("source document read contracts", () => {
  it.each([
    ["KWD", "1.234"],
    ["JPY", "1"],
    ["CNY", "1.23"],
  ])("uses %s precision for the retained accounting result", (mainCurrency, total) => {
    expect(
      mapSourceDocumentDetail(row, { ...hydration, mainCurrency }).activeResultSummary
    ).toEqual({ entryCount: 1, total });
  });
  it("reports no total rather than substituting a foreign original amount for a missing rate", () => {
    expect(
      mapSourceDocumentDetail(row, {
        ...hydration,
        ledgerEntries: [{ ...hydration.ledgerEntries[0]!, convertedAmount: null }],
      }).activeResultSummary
    ).toEqual({ entryCount: 1, total: null });
  });
  it("preserves exact totals above the safe integer limit", () => {
    expect(
      mapSourceDocumentDetail(row, {
        ...hydration,
        mainCurrency: "CNY",
        ledgerEntries: ["9007199254740992.01", "0.02"].map((convertedAmount) => ({
          ...hydration.ledgerEntries[0]!,
          convertedAmount,
        })),
      }).activeResultSummary?.total
    ).toBe("9007199254740992.03");
  });
  it("does not invent retained results for first-parse failures", () => {
    expect(
      mapSourceDocumentDetail(row, { ...hydration, ledgerEntries: [] }).activeResultSummary
    ).toBeUndefined();
  });
  it.each([
    ["storage_failure", "storage_failure"],
    ["ai_schema_invalid", "ai_schema_invalid"],
    ["old_unknown_error", "processing_unavailable"],
  ])("normalizes %s at both read boundaries", (failureCode, expected) => {
    const data = { ...hydration, failureCode };
    expect(mapListItem(row, data).errorCode).toBe(expected);
    expect(mapSourceDocumentDetail(row, data).errorCode).toBe(expected);
  });
  it("keeps invalid input distinct from processing errors", () => {
    expect(mapListItem(row, { ...hydration, failureKind: "invalid_input" }).errorCode).toBeNull();
    expect(mapListItem(row, { ...hydration, processingStatus: "completed" }).errorCode).toBeNull();
  });
});
