import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { entryCategories, ledgerEntries, ledgers } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";

import { listCategoriesWithCount } from "@/modules/ledger/server/categories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  todayUtc,
} from "tests/helpers/schema-setup";

async function getTargetEntryCategoriesAction() {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    columns: { id: true },
  });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return listCategoriesWithCount();
}

describe("listCategoriesWithCount", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values({});
    await ensureTestLedgerBooks(db);
  });

  it("returns categories sorted by sortOrder", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: randomUUID(), name: "B", sortOrder: 2 },
      { id: randomUUID(), name: "A", sortOrder: 1 },
      { id: randomUUID(), name: "C", sortOrder: 3 },
    ]);

    const result = await getTargetEntryCategoriesAction();
    expect(result.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("includes entry count per category", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        documentDate: todayUtc(),
        id: randomUUID(),
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(doc).toBeDefined();
    if (doc === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Item 1",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Item 2",
        amount: "20.00",
        currency: "CNY",
        categoryId: catId,
      },
    ]);

    const result = await getTargetEntryCategoriesAction();
    const firstCategory = result[0];
    expect(firstCategory).toBeDefined();
    expect(firstCategory?.entryCount).toBe(2);
  });
});
