import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { entryCategories as categories, ledgerEntries, sourceDocuments } from "@/persistence";
import { createTestLedger, createTestSourceDocument } from "tests/helpers/schema-setup";
import { must } from "tests/helpers/must";

/**
 * FK Constraint Tests for LedgerEntries
 *
 * These tests verify schema-level foreign key behaviors that are not covered
 * by integration tests. Basic CRUD operations are tested through Server Actions
 * in tests/integration/modules/ledger/server{,-actions}/ledger-entries*.test.ts
 */
describe("LedgerEntries FK Constraints", () => {
  it("should cascade delete ledger entries when their source document is deleted", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const sourceDocId = await createTestSourceDocument(db);

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        sourceDocumentId: sourceDocId,
        amount: "25.00",
        currency: "CNY",
        itemName: "Will Be Deleted",
      })
      .returning({ id: ledgerEntries.id });

    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocId));

    const orphaned = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.id, entry!.id),
    });

    expect(orphaned).toHaveLength(0);
  });

  it("should set categoryId to null when category is deleted", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const [categoryRow] = await db
      .insert(categories)
      .values({
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();

    const sourceDocId = await createTestSourceDocument(db);

    const category = must(categoryRow, "category");

    const [txRow] = await db
      .insert(ledgerEntries)
      .values({
        sourceDocumentId: sourceDocId,
        categoryId: category.id,
        amount: "25.00",
        currency: "CNY",
        itemName: "午餐",
      })
      .returning();
    const tx = must(txRow, "tx");

    await db.delete(categories).where(eq(categories.id, category.id));

    const found = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, tx.id),
    });

    expect(found).toMatchObject({ id: tx.id, categoryId: null });
  });
});
