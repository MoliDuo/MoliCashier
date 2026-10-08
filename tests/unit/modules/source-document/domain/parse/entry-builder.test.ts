import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatDateTimeForApiMock } = vi.hoisted(() => ({
  formatDateTimeForApiMock: vi.fn(),
}));

vi.mock("@/lib/date-utils", () => ({
  formatDateTimeForApi: formatDateTimeForApiMock,
}));

import {
  buildEntriesForInsert,
  getEntryFallbackDate,
  validateEntries,
} from "@/modules/source-document/domain/parse/entry-builder";

describe("entry-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatDateTimeForApiMock.mockReturnValue("2026-03-23");
  });

  it("keeps each amount in its own currency, rounded to that currency", () => {
    const [entry] = buildEntriesForInsert({
      validEntries: [
        {
          amount: "12.345",
          currency: "USD",
          categoryIndex: 1,
          entryDate: null,
          itemName: "",
          notes: null,
        },
      ],
      categories: [{ id: "cat-1", name: "Food", description: null }],
      sourceDocumentId: "doc-1",
      fallbackDate: "2026-03-20",
    });

    expect(entry).toMatchObject({
      amount: "12.35",
      currency: "USD",
      itemName: "未命名项目",
      categoryId: "cat-1",
      entryDate: "2026-03-20",
    });
    expect(entry).not.toHaveProperty("convertedAmount");
  });

  it("trims the item name and names a blank one in the ledger's language", () => {
    const build = (itemName: string, aiLanguage?: string) =>
      buildEntriesForInsert({
        validEntries: [
          {
            amount: "5.00",
            currency: "USD",
            categoryIndex: 0,
            entryDate: null,
            itemName,
            notes: null,
          },
        ],
        categories: [],
        sourceDocumentId: "doc-1",
        fallbackDate: "2026-03-20",
        ...(aiLanguage === undefined ? {} : { aiLanguage }),
      })[0]?.itemName;

    expect(build("  Latte \n")).toBe("Latte");
    expect(build("   ", "en-US")).toBe("Unnamed item");
    expect(build("\t", "zh-CN")).toBe("未命名项目");
  });

  it("category_index 0 means no category — categoryId is null", () => {
    const result = buildEntriesForInsert({
      validEntries: [
        {
          amount: "10",
          currency: "CNY",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Unknown item",
          notes: null,
        },
      ],
      categories: [
        { id: "cat-0", name: "Food", description: null },
        { id: "cat-1", name: "Transport", description: null },
      ],
      sourceDocumentId: "doc-1",
      fallbackDate: "2026-03-20",
    });

    const firstEntry = result[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry == null) {
      throw new Error("Expected first built entry");
    }

    expect(firstEntry.categoryId).toBeNull();
  });

  it("category_index 1 maps to first category, category_index 2 maps to second (1-based)", () => {
    const result = buildEntriesForInsert({
      validEntries: [
        {
          amount: "10",
          currency: "CNY",
          categoryIndex: 1,
          entryDate: null,
          itemName: "Groceries",
          notes: null,
        },
        {
          amount: "20",
          currency: "CNY",
          categoryIndex: 2,
          entryDate: null,
          itemName: "Bus ticket",
          notes: null,
        },
      ],
      categories: [
        { id: "cat-0", name: "Food", description: null },
        { id: "cat-1", name: "Transport", description: null },
      ],
      sourceDocumentId: "doc-1",
      fallbackDate: "2026-03-20",
    });

    const firstEntry = result[0];
    const secondEntry = result[1];
    expect(firstEntry).toBeDefined();
    expect(secondEntry).toBeDefined();
    if (firstEntry == null || secondEntry == null) {
      throw new Error("Expected two built entries");
    }

    expect(firstEntry.categoryId).toBe("cat-0");
    expect(secondEntry.categoryId).toBe("cat-1");
  });

  it("allows negative adjustment rows through validation", () => {
    expect(
      validateEntries([
        {
          amount: "-2",
          currency: "USD",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Discount",
          notes: null,
          isAdjustment: true,
        },
      ])
    ).toEqual({ isValid: true });
  });

  it("rejects entries with no positive amounts or unknown currencies", () => {
    expect(
      validateEntries([
        {
          amount: "0",
          currency: "CNY",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Ignored",
          notes: null,
        },
      ])
    ).toEqual({ isValid: false, reason: "Invalid expense amount" });

    expect(
      validateEntries([
        {
          amount: "12",
          currency: "unknown",
          categoryIndex: 0,
          entryDate: null,
          itemName: "Bad currency",
          notes: null,
        },
      ])
    ).toEqual({ isValid: false, reason: "Unable to recognize currency type" });
  });

  it("uses the document entry date when present and today otherwise", () => {
    expect(getEntryFallbackDate("2026-03-20", "2026-03-23")).toEqual({
      todayDate: "2026-03-23",
      fallbackDate: "2026-03-20",
    });

    expect(getEntryFallbackDate(null, "2026-03-23")).toEqual({
      todayDate: "2026-03-23",
      fallbackDate: "2026-03-23",
    });
  });
});
