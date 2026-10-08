import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { createOpenAIMock } from "tests/helpers/mocks/ai-parser-reply";
import { processAllPendingTasks } from "tests/helpers/processing";
import { ledgerEntries, ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { setAiTransportForTests } from "@/lib/ai/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { SIGN_IN_PATH } from "@/modules/auth/constants";
import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";

const MISSING_ID = "00000000-0000-4000-8000-000000000001";

describe("source document batch actions", () => {
  afterEach(() => {
    setAiTransportForTests(null);
  });

  beforeEach(async () => {
    setAiTransportForTests(createOpenAIMock());
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
  });

  it("deletes each document on its own and reports a missing one under a stable code", async () => {
    const db = getTestDb();
    const kept = await createTestSourceDocument(db);
    const deleted = await createTestSourceDocument(db);

    const result = await batchDeleteSourceDocumentsAction([MISSING_ID, deleted]);

    expect(result).toEqual({
      succeeded: [{ id: deleted, sourceDocumentId: deleted }],
      failed: [{ id: MISSING_ID, code: "NOT_FOUND" }],
    });
    const remaining = await db.select({ id: sourceDocuments.id }).from(sourceDocuments);
    expect(remaining.map((row) => row.id)).toEqual([kept]);
  });

  it("refuses an empty batch and runs a duplicated target once", async () => {
    const document = await createTestSourceDocument(getTestDb());

    await expect(batchDeleteSourceDocumentsAction([])).rejects.toThrow(ValidationError);
    await expect(batchDeleteSourceDocumentsAction([document, document])).resolves.toEqual({
      succeeded: [{ id: document, sourceDocumentId: document }],
      failed: [],
    });
  });

  it("keeps retrying later documents after one fails, inheriting each one's evidence", async () => {
    const db = getTestDb();
    const document = await createTestSourceDocument(db, { text: "午餐 25元" });

    const result = await batchRetrySourceDocumentsAction([MISSING_ID, document]);

    expect(result).toEqual({
      succeeded: [{ id: document, sourceDocumentId: document }],
      failed: [{ id: MISSING_ID, code: "NOT_FOUND" }],
    });
    await processAllPendingTasks();
    const attempts = await db
      .select()
      .from(extractionAttempts)
      .where(eq(extractionAttempts.sourceDocumentId, document))
      .orderBy(asc(extractionAttempts.submittedAt));
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({ status: "completed" });
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document) })
    ).resolves.toMatchObject({
      inputText: "午餐 25元",
      latestAttemptId: attempts[1]!.id,
    });
    await expect(
      db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceDocumentId, document))
    ).resolves.toHaveLength(1);
  });

  it("sends a signed-out session to sign in and passes other access failures through", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(batchDeleteSourceDocumentsAction([MISSING_ID])).rejects.toMatchObject({
      digest: expect.stringContaining(SIGN_IN_PATH),
    });

    // Without the ledger the action reports it as not found, never re-labelled
    // as a sign-in problem.
    await getTestDb().delete(ledgers);
    await expect(batchRetrySourceDocumentsAction([MISSING_ID])).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
