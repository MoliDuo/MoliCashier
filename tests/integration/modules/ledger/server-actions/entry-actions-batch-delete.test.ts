import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers, ledgerEntries, extractionAttempts } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { batchDeleteLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  todayUtc,
} from "tests/helpers/schema-setup";
import { must } from "tests/helpers/must";

async function seedDoc(db: ReturnType<typeof getTestDb>, entryDate?: string) {
  const [docRow] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      documentDate: entryDate ?? todayUtc(),
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  const doc = must(docRow, "doc");
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

describe("batchDeleteLedgerEntriesAction", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values({
      id: randomUUID(),
      mainCurrency: "CNY",
    });
    await ensureTestLedgerBooks(db);
  });

  it("deletes multiple entries from one document without creating an attempt", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20, 30].map((amount, index) => ({
          id: randomUUID(),
          sourceDocumentId: doc.id,
          itemName: `Item ${index}`,
          amount: String(amount),
          currency: "CNY",
        }))
      )
      .returning();
    await activateTestSourceDocumentProjection(db, doc.id);

    const beforeAttemptCount = await db
      .select({ id: extractionAttempts.id })
      .from(extractionAttempts)
      .where(eq(extractionAttempts.sourceDocumentId, doc.id));
    const result = await batchDeleteLedgerEntriesAction(
      [doc.id],
      entries.slice(0, 2).map((entry) => entry.id)
    );

    expect(result.succeeded.map((item) => item.id).sort()).toEqual(
      entries
        .slice(0, 2)
        .map((entry) => entry.id)
        .sort()
    );
    expect(result.failed).toHaveLength(0);
    const afterAttemptCount = await db
      .select({ id: extractionAttempts.id })
      .from(extractionAttempts)
      .where(eq(extractionAttempts.sourceDocumentId, doc.id));
    expect(afterAttemptCount).toHaveLength(beforeAttemptCount.length);

    const activeEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, doc.id),
    });
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.itemName).toBe("Item 2");
  });

  it("deletes entries of a document that never had a parse attempt", async () => {
    const db = getTestDb();
    const [docRow] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        documentDate: todayUtc(),
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = must(docRow, "doc");
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20].map((amount, index) => ({
          id: randomUUID(),
          sourceDocumentId: doc.id,
          itemName: `Typed ${index}`,
          amount: String(amount),
          currency: "CNY",
        }))
      )
      .returning();

    const result = await batchDeleteLedgerEntriesAction(
      [doc.id],
      entries.map((entry) => entry.id)
    );

    // Entries belong to their document, whether or not a parse wrote them.
    expect(result.failed).toEqual([]);
    expect(result.succeeded.map((item) => item.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );
    const remaining = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, doc.id),
    });
    expect(remaining).toEqual([]);
  });

  it("commits one document's deletion independently of another document's failure in the same batch", async () => {
    const db = getTestDb();
    const okDoc = await seedDoc(db);
    const badDoc = await seedDoc(db);
    const [okEntry] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        sourceDocumentId: okDoc.id,
        itemName: "Keeper's sibling",
        amount: "10",
        currency: "CNY",
      })
      .returning();
    await activateTestSourceDocumentProjection(db, okDoc.id);
    // A ledger entry that does not belong to `badDoc`'s active projection —
    // this group's transaction throws, so it must land in `failed`.
    const foreignEntryId = randomUUID();

    const result = await batchDeleteLedgerEntriesAction(
      [okDoc.id, badDoc.id],
      [okEntry!.id, foreignEntryId]
    );

    expect(result.succeeded).toEqual([{ id: okEntry!.id, sourceDocumentId: okDoc.id }]);
    expect(result.failed).toEqual([{ id: foreignEntryId, code: "NOT_FOUND" }]);

    const okDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, okDoc.id),
    });
    expect(okDocument?.version).toBe(2);
    const badDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, badDoc.id),
    });
    // `badDoc` was never targeted by a real write — its own group failed
    // before touching its document row.
    expect(badDocument?.version).toBe(1);
  });

  it("fails every entry of a document's group together, without writes, while it is processing", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20].map((amount, index) => ({
          id: randomUUID(),
          sourceDocumentId: doc.id,
          itemName: `Group item ${index}`,
          amount: String(amount),
          currency: "CNY",
        }))
      )
      .returning();
    await activateTestSourceDocumentProjection(db, doc.id);
    // A retry is being parsed: it will replace the entries when it completes,
    // so the group's transaction refuses the write as a whole.
    const [attempt] = await db
      .insert(extractionAttempts)
      .values({ sourceDocumentId: doc.id, status: "processing" })
      .returning();
    await db
      .update(sourceDocuments)
      .set({ latestAttemptId: attempt!.id })
      .where(eq(sourceDocuments.id, doc.id));

    const result = await batchDeleteLedgerEntriesAction(
      [doc.id],
      entries.map((entry) => entry.id)
    );

    expect(result.succeeded).toEqual([]);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    // Zero writes: the document's version and entries are untouched.
    expect(document?.version).toBe(1);
    const activeEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, doc.id),
    });
    expect(activeEntries.map((entry) => entry.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );
  });
});
