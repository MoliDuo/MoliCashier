import { describe, expect, it } from "vitest";
import {
  diffAiCorrections,
  nextCorrectionWrite,
  UNCATEGORIZED_VALUE,
  type CorrectableEntry,
  type PreviousCorrectableEntry,
} from "@/modules/ledger/domain/ai-corrections";

const names: Record<string, string> = { food: "餐饮", transport: "交通" };
const categoryName = (id: string | null) =>
  id == null ? UNCATEGORIZED_VALUE : (names[id] ?? UNCATEGORIZED_VALUE);

function entry(overrides: Partial<PreviousCorrectableEntry> = {}): PreviousCorrectableEntry {
  return {
    id: "entry-1",
    categoryId: "food",
    itemName: "Latte",
    amount: "28.000",
    currency: "CNY",
    extracted: true,
    ...overrides,
  };
}

function next(overrides: Partial<CorrectableEntry> = {}): CorrectableEntry {
  const { extracted: _extracted, ...base } = entry();
  return { ...base, ...overrides };
}

describe("diffAiCorrections", () => {
  it("reports a changed category by name", () => {
    const changes = diffAiCorrections({
      previousEntries: [entry()],
      nextEntries: [next({ categoryId: "transport" })],
      categoryName,
    });

    expect(changes).toEqual([
      {
        subjectId: "entry-1",
        field: "category",
        before: "餐饮",
        after: "交通",
        context: { itemName: "Latte", amount: "28.000", currency: "CNY" },
      },
    ]);
  });

  it("reports a category cleared to none as the uncategorized value", () => {
    const [change] = diffAiCorrections({
      previousEntries: [entry()],
      nextEntries: [next({ categoryId: null })],
      categoryName,
    });

    expect(change).toMatchObject({ field: "category", before: "餐饮", after: UNCATEGORIZED_VALUE });
  });

  it("reports a renamed item with the new name as context", () => {
    const [change] = diffAiCorrections({
      previousEntries: [entry()],
      nextEntries: [next({ itemName: "拿铁" })],
      categoryName,
    });

    expect(change).toMatchObject({
      field: "item_name",
      before: "Latte",
      after: "拿铁",
      context: { itemName: "拿铁" },
    });
  });

  it("ignores amount, currency, entries the owner added and entries that are gone", () => {
    const changes = diffAiCorrections({
      previousEntries: [
        entry({ id: "a" }),
        entry({ id: "owner-added", extracted: false }),
        entry({ id: "removed" }),
      ],
      nextEntries: [
        next({ id: "a", amount: "30.000", currency: "USD" }),
        next({ id: "owner-added", categoryId: "transport", itemName: "Other" }),
      ],
      categoryName,
    });

    expect(changes).toEqual([]);
  });

  it("reports a title change only when the AI wrote the title", () => {
    const base = {
      previousEntries: [],
      nextEntries: [],
      categoryName,
      document: { id: "doc-1", previousTitle: "STARBUCKS #123", nextTitle: "星巴克" },
    };

    expect(diffAiCorrections({ ...base, titleFromAi: false })).toEqual([]);
    expect(diffAiCorrections({ ...base, titleFromAi: true })).toEqual([
      {
        subjectId: "doc-1",
        field: "title",
        before: "STARBUCKS #123",
        after: "星巴克",
        context: { itemName: null, amount: null, currency: null },
      },
    ]);
  });

  it("reports nothing for an unchanged or unset title", () => {
    const base = { previousEntries: [], nextEntries: [], categoryName, titleFromAi: true };

    expect(
      diffAiCorrections({
        ...base,
        document: { id: "doc-1", previousTitle: "A", nextTitle: "A" },
      })
    ).toEqual([]);
    expect(
      diffAiCorrections({
        ...base,
        document: { id: "doc-1", previousTitle: "A", nextTitle: undefined },
      })
    ).toEqual([]);
  });
});

describe("nextCorrectionWrite", () => {
  it("stores the first edit with the value before it", () => {
    expect(nextCorrectionWrite(null, { before: "餐饮", after: "交通" })).toEqual({
      kind: "upsert",
      beforeValue: "餐饮",
      afterValue: "交通",
    });
  });

  it("keeps the AI's own value as the before when the owner edits again", () => {
    expect(
      nextCorrectionWrite(
        { beforeValue: "餐饮", afterValue: "交通" },
        { before: "交通", after: "购物" }
      )
    ).toEqual({ kind: "upsert", beforeValue: "餐饮", afterValue: "购物" });
  });

  it("removes the row when the owner restores the AI's value", () => {
    expect(
      nextCorrectionWrite(
        { beforeValue: "餐饮", afterValue: "交通" },
        { before: "交通", after: "餐饮" }
      )
    ).toEqual({ kind: "delete" });
  });

  it("writes nothing for a change that leaves nothing to record", () => {
    expect(nextCorrectionWrite(null, { before: "A", after: "A" })).toEqual({ kind: "none" });
    expect(
      nextCorrectionWrite({ beforeValue: "A", afterValue: "B" }, { before: "B", after: "B" })
    ).toEqual({ kind: "none" });
  });
});
