import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { getTestDb } from "tests/setup";
import {
  books,
  entryCategories as categories,
  ledgerEntries,
  extractionAttempts,
  sourceDocuments,
  ledgers,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { createOpenAIMock } from "tests/helpers/mocks/ai-parser-reply";

import { setAiTransportForTests } from "@/lib/ai/client";
import { processAllPendingTasks } from "tests/helpers/processing";

describe("SourceDocument Actions", () => {
  let testCategoryId: string;

  function firstItem<T>(items: T[], errorMessage: string): T {
    const first = items[0];
    if (first == null) {
      throw new Error(errorMessage);
    }
    return first;
  }

  const createDocument = (input: Parameters<typeof createSourceDocumentAction>[0]) =>
    createSourceDocumentAction(input, crypto.randomUUID());

  afterEach(() => {
    setAiTransportForTests(null);
  });

  beforeEach(async () => {
    // Reset mock to use multi-stage mock by default
    setAiTransportForTests(createOpenAIMock());

    const db = getTestDb();

    // Clean up the existing ledger and create a new one
    await db.delete(ledgers);
    await createTestLedger(db);

    const newCat = firstItem(
      await db
        .insert(categories)
        .values({
          name: "餐饮",
          description: "外卖、堂食",
          sortOrder: 1,
        })
        .returning(),
      "Expected category to be created in setup"
    );
    testCategoryId = newCat.id;

    // Ensure '水果' category exists for the notes test
    await db.insert(categories).values({
      name: "水果",
      description: "Fresh Fruit",
      sortOrder: 2,
    });
  });

  it("should persist ledger entries with notes", async () => {
    // Override mock for this test with custom entries
    setAiTransportForTests(
      createOpenAIMock({
        categories: ["水果"],
        entries: [
          {
            item_name: "苹果",
            amount: "20",
            currency: "CNY",
            category_index: 1,
            notes: "2kg * 10元/kg, 红富士苹果",
          },
        ],
      })
    );

    const result = await createDocument({
      text: "苹果2公斤，每公斤10元",
    });

    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId),
    });

    expect(savedEntry).toBeDefined();
    expect(savedEntry?.itemName).toBe("苹果");
    // Ensure notes are saved in description
    expect(savedEntry?.description).toContain("2kg");
    expect(savedEntry?.description).toContain("10元");
  });

  it("should process text message and create ledger entry", async () => {
    const result = await createDocument({ text: "午餐花了25.5元" });
    expect(result.sourceDocumentId).toBeDefined();
    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId!),
    });

    expect(savedEntries).toHaveLength(1);
    const savedEntry = firstItem(savedEntries, "Expected one saved ledger entry");
    expect(savedEntry.itemName).toBe("午餐");
    expect(savedEntry.amount).toBe("25.500");
  });

  it("should match category by index", async () => {
    const result = await createDocument({ text: "午餐" });
    expect(result).toMatchObject({ version: 1, status: "processing" });

    // Process
    await processAllPendingTasks();

    const db = getTestDb();
    const savedEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, result.sourceDocumentId!),
      with: { category: true },
    });

    expect(savedEntries).toHaveLength(1);
    const savedEntry = firstItem(savedEntries, "Expected one categorized ledger entry");
    expect(savedEntry.categoryId).toBe(testCategoryId);
    expect(savedEntry.category).toBeDefined();
    expect(savedEntry.category?.name).toBe("餐饮");
  });

  it("should save input message with AI response", async () => {
    const result = await createDocument({ text: "午餐25元" });

    const db = getTestDb();
    const savedDoc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.sourceDocumentId!),
    });

    expect(savedDoc).toBeDefined();
    expect(savedDoc).not.toHaveProperty("text");
    expect(savedDoc).not.toHaveProperty("imageUrls");
    expect(savedDoc?.inputText).toBe("午餐25元");
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.sourceDocumentId, result.sourceDocumentId!),
    });
    expect(attempt?.status).toBe("processing");

    // Process tasks to ensure cleanup
    await processAllPendingTasks();
  });

  it("replays a browser create without duplicating persisted work", async () => {
    const clientSubmissionId = crypto.randomUUID();
    const input = { text: "Idempotent lunch 25" };

    const first = await createSourceDocumentAction(input, clientSubmissionId);
    const replay = await createSourceDocumentAction(input, clientSubmissionId);

    expect(replay).toEqual(first);
    const db = getTestDb();
    expect(
      await db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.id, first.sourceDocumentId),
      })
    ).toHaveLength(1);
    const attempts = await db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.sourceDocumentId, first.sourceDocumentId),
    });
    expect(attempts).toHaveLength(1);
    // The one attempt is the document's single queued processing attempt.
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.sourceDocumentId) })
    ).resolves.toMatchObject({ latestAttemptId: attempts[0]!.id });
  });

  it("should return error when no input provided", async () => {
    await expect(createSourceDocumentAction({}, crypto.randomUUID())).rejects.toThrow(
      "Content (text or images) is required"
    );
  });

  it("should delete source document and associated ledger entries", async () => {
    // 1. Create a message first
    const createRes = await createDocument({
      text: "待删除的项目 100元",
    });
    const sourceDocumentId = createRes.sourceDocumentId!;

    // Process
    await processAllPendingTasks();

    // Verify ledger entry exists
    const db = getTestDb();
    const entriesBefore = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
    });
    expect(entriesBefore.length).toBeGreaterThan(0);

    // 2. DELETE request
    await deleteSourceDocumentAction(sourceDocumentId);

    // 3. Verify deletion
    const docAfter = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(docAfter).toBeUndefined();

    const entriesAfter = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
    });
    expect(entriesAfter).toEqual([]);
  });

  describe("the zone a new record is dated in", () => {
    // 20:00 UTC on 20 March is already the 21st in Singapore but still the
    // 20th in Paris.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-20T20:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function createdDate(input: Parameters<typeof createSourceDocumentAction>[0]) {
      const result = await createDocument(input);
      const document = await getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, result.sourceDocumentId),
      });
      const attempt = await getTestDb().query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.sourceDocumentId, result.sourceDocumentId),
      });
      await processAllPendingTasks();
      return { bookId: document?.bookId, date: attempt?.requestedDate };
    }

    it("files the record into the chosen book and dates it in the ledger's zone", async () => {
      const [book] = await getTestDb()
        .insert(books)
        .values({ name: "哞哞的", sortOrder: 2 })
        .returning({ id: books.id });
      const bookId = book!.id;
      await getTestDb().update(ledgers).set({ timeZone: "Asia/Singapore" });

      await expect(createdDate({ text: "Lunch 12", bookId })).resolves.toEqual({
        bookId,
        date: "2026-03-21",
      });
    });

    it("follows the ledger's zone when it changes", async () => {
      const bookId = await testBookId(getTestDb());
      await getTestDb().update(ledgers).set({ timeZone: "Europe/Paris" });

      await expect(createdDate({ text: "Lunch 12" })).resolves.toEqual({
        bookId,
        date: "2026-03-20",
      });
    });
  });

  it("scopes browser idempotency to the payload as well as the key", async () => {
    const clientSubmissionId = crypto.randomUUID();
    await createSourceDocumentAction({ text: "Lunch 25" }, clientSubmissionId);

    await expect(
      createSourceDocumentAction({ text: "Dinner 40" }, clientSubmissionId)
    ).rejects.toThrow();
    await expect(createSourceDocumentAction({ text: "Lunch" }, "not-a-uuid")).rejects.toThrow(
      "Invalid UUID"
    );
    expect(await getTestDb().select().from(sourceDocuments)).toHaveLength(1);
    await processAllPendingTasks();
  });
});
