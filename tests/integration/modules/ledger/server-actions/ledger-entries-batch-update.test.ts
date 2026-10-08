import { describe, it, expect, beforeEach } from "vitest";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import { getTestDb } from "tests/setup";
import { ledgerEntries, entryCategories, ledgers } from "@/persistence";
import { inArray } from "drizzle-orm";
import {
  createTestLedger,
  createTestSourceDocument,
  activateTestSourceDocumentProjection,
} from "tests/helpers/schema-setup";
import { must } from "tests/helpers/must";

describe("Batch Update Ledger Entries Action", () => {
  let testEntryIds: string[];
  let testCategoryId: string;
  let testSourceDocId: string;

  beforeEach(async () => {
    const db = getTestDb();

    await db.delete(ledgers);
    await createTestLedger(db);

    const [categoryRow] = await db
      .insert(entryCategories)
      .values({ name: "Dining", sortOrder: 1 })
      .returning();
    const category = must(categoryRow, "category");
    testCategoryId = category.id;

    // Create a test source document for entries
    testSourceDocId = await createTestSourceDocument(db);

    const entries = await db
      .insert(ledgerEntries)
      .values([
        {
          sourceDocumentId: testSourceDocId,
          amount: "100",
          currency: "CNY",
          itemName: "Item 1",
          description: "Initial description 1",
        },
        {
          sourceDocumentId: testSourceDocId,
          amount: "200",
          currency: "CNY",
          itemName: "Item 2",
          description: "Initial description 2",
        },
      ])
      .returning();
    testEntryIds = entries.map((e) => e.id);
    await activateTestSourceDocumentProjection(db, testSourceDocId);
  });

  it("should batch update category and currency", async () => {
    await batchUpdateLedgerEntriesAction([testSourceDocId], testEntryIds, {
      categoryId: testCategoryId,
      currency: "USD",
    });

    // Verify in DB
    const db = getTestDb();
    const updatedEntries = await db
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    updatedEntries.forEach((entry) => {
      expect(entry.categoryId).toBe(testCategoryId);
      expect(entry.currency).toBe("USD");
    });
  });

  it("normalizes a cleared currency to the ledger main currency", async () => {
    await batchUpdateLedgerEntriesAction([testSourceDocId], testEntryIds, { currency: null });

    const updatedEntries = await getTestDb()
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    expect(updatedEntries.every((entry) => entry.currency === "CNY")).toBe(true);
  });

  it("should batch update description", async () => {
    const newDescription = "Batch updated description";

    await batchUpdateLedgerEntriesAction([testSourceDocId], testEntryIds, {
      description: newDescription,
    });

    // Verify in DB
    const db = getTestDb();
    const updatedEntries = await db
      .select()
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, testEntryIds));

    expect(updatedEntries).toHaveLength(2);
    updatedEntries.forEach((entry) => {
      expect(entry.description).toBe(newDescription);
    });
  });
});
