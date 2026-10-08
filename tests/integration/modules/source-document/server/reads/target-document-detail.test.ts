import { sql } from "drizzle-orm";
import { describe, it, expect } from "vitest";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { getTestDb } from "tests/setup";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import {
  createLedgerData,
  createSourceDocumentData,
  createCategoryData,
  createLedgerEntryData,
} from "tests/helpers/factories";
import { randomUUID } from "node:crypto";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { must } from "tests/helpers/must";

describe("getTargetSourceDocument", () => {
  it("should return source document with basic data", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db);

    const docData = createSourceDocumentData({
      title: "Test Receipt",
      text: "Lunch for 25.50",
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, docData.id, { text: "Lunch for 25.50" });

    const result = await getTargetSourceDocument(docData.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(docData.id);
    expect(result!.title).toBe("Test Receipt");
    expect(result!.text).toBe("Lunch for 25.50");
    expect(result!.hasImages).toBe(false);
    expect(result).not.toHaveProperty("metadata");
  });

  it("should include stored-file identities in the normalized light response", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db);

    const docData = createSourceDocumentData({
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, docData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });

    const result = await getTargetSourceDocument(docData.id);

    expect(result).not.toBeNull();
    expect(result!.hasImages).toBe(true);
    expect(result!.files).toEqual([
      expect.objectContaining({ id: expect.any(String), contentType: "image/jpeg" }),
    ]);
    expect(result).not.toHaveProperty("imageUrls");
  });

  it("should include associated ledgerEntries", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db);

    const categoryData = createCategoryData();
    await db.insert(entryCategories).values(categoryData);

    const docData = createSourceDocumentData();
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });

    const entryData = createLedgerEntryData({
      sourceDocumentId: docData.id,
      categoryId: categoryData.id,
      itemName: "Test Entry",
    });
    await db.insert(ledgerEntries).values(entryData);
    await activateTestSourceDocumentProjection(db, docData.id);

    const result = await getTargetSourceDocument(docData.id);

    expect(result).not.toBeNull();
    if (result == null) {
      throw new Error("Expected source document light result");
    }
    expect(result.ledgerEntries).toHaveLength(1);
    const firstEntry = must(result.ledgerEntries[0], "first ledger entry");
    expect(firstEntry.itemName).toBe("Test Entry");
    expect(firstEntry.category?.name).toBe(categoryData.name);
  });

  it("should return null when document does not exist", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db);

    const result = await getTargetSourceDocument(randomUUID());
    expect(result).toBeNull();
  });
});
