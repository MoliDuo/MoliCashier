import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { claimAttemptForTest, createPendingAttempt } from "tests/helpers/processing-attempt";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import { AI_OUTPUT_COPY } from "@/config/ai-output-locales";

const entry = (itemName: string, categoryId: string | null = null) => ({
  categoryId,
  amount: "12.00",
  currency: "CNY",
  itemName,
  description: null,
});

/** A titled record with a parse of its input in flight. */
async function createProcessingRecord(title: string | null) {
  const db = getTestDb();
  await createTestLedger(db);
  const bookId = await testBookId(db);
  const record = await createTestRecord(db, {
    bookId,
    title,
    entryDate: "2026-09-10",
    entries: [entry("Old row")],
  });
  const pending = await createPendingAttempt({
    sourceDocumentId: record.sourceDocumentId,
    input: { text: "latte 12", storedFileIds: [], documentDate: null },
  });
  const lease = await claimAttemptForTest(pending.attempt.id);
  return { db, sourceDocumentId: record.sourceDocumentId, attemptId: pending.attempt.id, lease };
}

async function storedDocument(sourceDocumentId: string) {
  return getTestDb().query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
}

describe("activateAttempt", () => {
  it("files an entry as uncategorised when its category was deleted during the parse", async () => {
    const fixture = await createProcessingRecord("Cafe");
    const [category] = await fixture.db
      .insert(entryCategories)
      .values({ name: "餐饮", sortOrder: 1 })
      .returning();
    const [kept] = await fixture.db
      .insert(entryCategories)
      .values({ name: "交通", sortOrder: 2 })
      .returning();
    // The worker read the categories before the model call; one goes away
    // before the result is written.
    await fixture.db.delete(entryCategories).where(eq(entryCategories.id, category!.id));

    const activated = await activateAttempt({
      sourceDocumentId: fixture.sourceDocumentId,
      attemptId: fixture.attemptId,
      lease: fixture.lease,
      title: "Cafe",
      entries: [entry("Latte", category!.id), entry("Taxi", kept!.id)],
    });

    expect(activated).toBe(true);
    const rows = await fixture.db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, fixture.sourceDocumentId),
      orderBy: (row, { asc }) => [asc(row.position)],
    });
    expect(rows.map((row) => [row.itemName, row.categoryId])).toEqual([
      ["Latte", null],
      ["Taxi", kept!.id],
    ]);
  });

  it("keeps the record's title when the parse only found the placeholder", async () => {
    const fixture = await createProcessingRecord("Typed by hand");

    await activateAttempt({
      sourceDocumentId: fixture.sourceDocumentId,
      attemptId: fixture.attemptId,
      lease: fixture.lease,
      title: AI_OUTPUT_COPY["zh-CN"].untitledDocument,
      entries: [entry("Latte")],
    });

    expect((await storedDocument(fixture.sourceDocumentId))?.title).toBe("Typed by hand");
  });

  it("writes the placeholder on a record that has no title yet", async () => {
    const fixture = await createProcessingRecord(null);

    await activateAttempt({
      sourceDocumentId: fixture.sourceDocumentId,
      attemptId: fixture.attemptId,
      lease: fixture.lease,
      title: AI_OUTPUT_COPY["en-US"].untitledDocument,
      entries: [entry("Latte")],
    });

    expect((await storedDocument(fixture.sourceDocumentId))?.title).toBe(
      AI_OUTPUT_COPY["en-US"].untitledDocument
    );
  });

  it("replaces the title with one the parse read from the document", async () => {
    const fixture = await createProcessingRecord("Typed by hand");

    await activateAttempt({
      sourceDocumentId: fixture.sourceDocumentId,
      attemptId: fixture.attemptId,
      lease: fixture.lease,
      title: "STARBUCKS",
      entries: [entry("Latte")],
    });

    expect((await storedDocument(fixture.sourceDocumentId))?.title).toBe("STARBUCKS");
  });
});
