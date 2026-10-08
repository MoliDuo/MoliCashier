import { describe, it, expect, beforeEach } from "vitest";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { getTestDb } from "tests/setup";
import { ledgers, entryCategories, ledgerEntries } from "@/persistence";
import {
  activateTestSourceDocumentProjection,
  createTestLedger,
  createTestSourceDocument,
} from "tests/helpers/schema-setup";

describe("listLedgerEntries", () => {
  let testCategoryId: string;
  let testSourceDocId: string;

  beforeEach(async () => {
    const db = getTestDb();

    // Clean up the existing ledger to avoid the singleton constraint
    await db.delete(ledgers);
    await createTestLedger(db);

    const [category] = await db
      .insert(entryCategories)
      .values({
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();
    expect(category).toBeDefined();
    if (category === undefined) {
      throw new Error("Expected category insert to return a row");
    }
    testCategoryId = category.id;

    // Create a test source document for entries
    testSourceDocId = await createTestSourceDocument(db);
  });

  it("should return empty array when no ledger entries exist", async () => {
    const data = await listLedgerEntries({});

    expect(data.items).toEqual([]);
    expect(data.nextCursor).toBeNull();
  });

  it("should return ledger entries with category relation", async () => {
    const db = getTestDb();
    await db.insert(ledgerEntries).values({
      categoryId: testCategoryId,
      sourceDocumentId: testSourceDocId,
      amount: "25.50",
      currency: "CNY",
      itemName: "午餐",
    });
    await activateTestSourceDocumentProjection(db, testSourceDocId);

    const data = await listLedgerEntries({});

    expect(data.items).toHaveLength(1);
    const firstItem = data.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.itemName).toBe("午餐");
    expect(firstItem?.category).toBeDefined();
    expect(firstItem?.category?.name).toBe("餐饮");
  });

  it("should filter by categoryId", async () => {
    const db = getTestDb();
    const [otherCategory] = await db
      .insert(entryCategories)
      .values({ name: "交通", sortOrder: 2 })
      .returning();
    expect(otherCategory).toBeDefined();
    if (otherCategory === undefined) {
      throw new Error("Expected category insert to return a row");
    }

    await db.insert(ledgerEntries).values([
      {
        categoryId: testCategoryId,
        sourceDocumentId: testSourceDocId,
        amount: "10",
        currency: "CNY",
        itemName: "餐饮交易",
      },
      {
        categoryId: otherCategory.id,
        sourceDocumentId: testSourceDocId,
        amount: "20",
        currency: "CNY",
        itemName: "交通交易",
      },
    ]);
    await activateTestSourceDocumentProjection(db, testSourceDocId);

    const data = await listLedgerEntries({ categoryId: testCategoryId });

    expect(data.items).toHaveLength(1);
    const firstItem = data.items[0];
    expect(firstItem).toBeDefined();
    expect(firstItem?.itemName).toBe("餐饮交易");
  });
});
