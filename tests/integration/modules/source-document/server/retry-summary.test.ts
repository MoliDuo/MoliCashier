import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { describe, expect, it } from "vitest";
import { createProcessingAttemptInTransaction } from "@/modules/source-document/server/extraction-attempts";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { createTestLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { addLedgerEntry } from "@/modules/source-document/server/entry-commands";
import { storedFiles } from "@/persistence";

const activeEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
} as const;

/**
 * Set up a document with entries and a failed/anomalous retry.
 */
async function setupDocumentWithFailedRetry(
  db: ReturnType<typeof getTestDb>,
  failureKind: "invalid_input" | "processing_error"
) {
  // Step 1: Create a document with entries
  const bookId = await testBookId(db);
  const created = await createTestRecord(getTestDb(), {
    title: "Original",
    entryDate: "2026-07-15",
    inputText: "Original text",
    entries: [activeEntry],
    bookId,
  });

  // Step 2: Create a pending attempt (processing)
  const pending = await db.transaction(async (tx) => {
    return createProcessingAttemptInTransaction(tx, {
      sourceDocumentId: created.sourceDocumentId,
      input: { text: "Retry text", storedFileIds: [], documentDate: null },
    });
  });

  // Step 3: Set the pending attempt outcome to invalid/failed
  await recordProcessingFailure({
    lease: await claimAttemptForTest(pending.attempt.id),
    sourceDocumentId: created.sourceDocumentId,
    attemptId: pending.attempt.id,
    failureKind,
    failureMessage: failureKind === "invalid_input" ? "Validation invalid" : "Processing failed",
  });

  return {
    sourceDocumentId: created.sourceDocumentId,
    latestAttemptId: pending.attempt.id,
  };
}

/**
 * Set up a document with ONLY a failed/anomalous submission (no entries).
 * Simulates a first-parse failure.
 */
async function setupDocumentWithFirstParseFailure(
  db: ReturnType<typeof getTestDb>,
  failureKind: "invalid_input" | "processing_error"
) {
  const bookId = await testBookId(db);
  const pending = await db.transaction((tx) =>
    createProcessingAttemptInTransaction(tx, {
      bookId,
      input: { text: "First parse", storedFileIds: [], documentDate: null },
    })
  );
  await recordProcessingFailure({
    lease: await claimAttemptForTest(pending.attempt.id),
    sourceDocumentId: pending.document.id,
    attemptId: pending.attempt.id,
    failureKind,
    failureMessage: failureKind === "invalid_input" ? "First parse invalid" : "Processing failed",
  });
  return { sourceDocumentId: pending.document.id, latestAttemptId: pending.attempt.id };
}

describe("retry active result summary", () => {
  it("includes the active result summary for terminal retries", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    for (const failureKind of ["invalid_input", "processing_error"] as const) {
      const { sourceDocumentId } = await setupDocumentWithFailedRetry(db, failureKind);

      const detail = await getTargetSourceDocument(sourceDocumentId);
      expect(detail).toMatchObject({
        processingStatus: "failed",
        failureKind,
        activeResultSummary: { entryCount: 1, total: "12.50" },
      });
    }
  });

  it("omits the active result summary when the failed first parse left no entries", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    for (const failureKind of ["invalid_input", "processing_error"] as const) {
      const { sourceDocumentId } = await setupDocumentWithFirstParseFailure(db, failureKind);

      const detail = await getTargetSourceDocument(sourceDocumentId);
      expect(detail).toMatchObject({ processingStatus: "failed", failureKind });
      expect(detail?.activeResultSummary).toBeUndefined();
    }
  });

  it("lets a document whose first parse failed be completed by hand", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const { sourceDocumentId } = await setupDocumentWithFirstParseFailure(db, "processing_error");
    const failed = await getTargetSourceDocument(sourceDocumentId);
    expect(failed).toMatchObject({ processingStatus: "failed", canEdit: true, ledgerEntries: [] });

    const { ledgerEntryId } = await addLedgerEntry({
      sourceDocumentId,
      amount: "18",
      currency: "CNY",
      itemName: "Taxi",
    });

    const edited = await getTargetSourceDocument(sourceDocumentId);
    expect(edited).toMatchObject({
      processingStatus: "failed",
      canEdit: true,
      text: "First parse",
      ledgerEntries: [expect.objectContaining({ id: ledgerEntryId, itemName: "Taxi" })],
      activeResultSummary: { entryCount: 1, total: "18.00" },
    });
    expect(edited?.version).toBe(failed!.version + 1);
  });

  it("keeps the previous entries when an edit-retry fails while showing its input and failure", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const created = await createTestRecord(getTestDb(), {
      title: "Original",
      entryDate: "2026-07-15",
      inputText: "Original text",
      entries: [activeEntry],
      bookId: await testBookId(db),
    });
    const [file] = await db
      .insert(storedFiles)
      .values({
        storageKey: "stored/edited-evidence",
        contentType: "image/jpeg",
        byteSize: 7,
      })
      .returning();
    const editRetry = await submitSourceDocument({
      sourceDocumentId: created.sourceDocumentId,
      inheritInput: false,
      supersedeProcessing: true,
      input: { text: "Edited text", storedFileIds: [file!.id], documentDate: null },
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(editRetry.attempt.id),
      sourceDocumentId: created.sourceDocumentId,
      attemptId: editRetry.attempt.id,
      failureKind: "processing_error",
      failureMessage: "Processing failed",
    });

    const stream = await listLedgerEntries({ limit: 20 });
    expect(stream.items).toEqual([
      expect.objectContaining({ itemName: "Lunch", amount: "12.500" }),
    ]);
    const detail = await getTargetSourceDocument(created.sourceDocumentId);
    expect(detail).toMatchObject({
      text: "Edited text",
      files: [expect.objectContaining({ id: file!.id })],
      processingStatus: "failed",
      failureKind: "processing_error",
      canEdit: true,
      ledgerEntries: [expect.objectContaining({ itemName: "Lunch" })],
      activeResultSummary: { entryCount: 1, total: "12.50" },
    });
    await expect(getSourceDocumentInput(created.sourceDocumentId)).resolves.toMatchObject({
      text: "Edited text",
      files: [expect.objectContaining({ id: file!.id })],
      processingStatus: "failed",
    });
  });

  it("activeResultSummary reflects accurate count and total with multiple entries", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    // Create a manual document with multiple entries
    const created = await createTestRecord(getTestDb(), {
      title: "Multi-entry",
      entryDate: "2026-07-15",
      inputText: "Multi entry doc",
      entries: [
        {
          categoryId: null,
          amount: "9007199254740992.01",
          currency: "CNY",
          itemName: "Item 1",
          description: null,
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 2",
          description: null,
        },
        {
          categoryId: null,
          amount: "0.01",
          currency: "CNY",
          itemName: "Item 3",
          description: null,
        },
      ],
      bookId: await testBookId(db),
    });

    // Create a failed pending attempt
    const pending = await db.transaction(async (tx) => {
      return createProcessingAttemptInTransaction(tx, {
        sourceDocumentId: created.sourceDocumentId,
        input: { text: "Failed retry", storedFileIds: [], documentDate: null },
      });
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(pending.attempt.id),
      sourceDocumentId: created.sourceDocumentId,
      attemptId: pending.attempt.id,
      failureKind: "processing_error",
      failureMessage: "Processing failed",
    });

    const detail = await getTargetSourceDocument(created.sourceDocumentId);
    expect(detail).toMatchObject({
      processingStatus: "failed",
      activeResultSummary: { entryCount: 3, total: "9007199254740992.03" },
    });
  });
});
