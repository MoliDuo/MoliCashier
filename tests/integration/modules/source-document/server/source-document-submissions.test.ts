import { archiveBook } from "@/modules/ledger/server/books";
import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import type { ObjectStore } from "@/lib/storage";
import { and, eq, isNull } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { storeProcessedImages } from "@/server/stored-files/uploads";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import {
  ledgerEntries,
  ledgers,
  serviceCredentials,
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
} from "@/persistence";
import { ConflictError, ValidationError } from "@/lib/errors";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import {
  createTestBooks,
  createTestLedger,
  testBookId,
  createTestRecord,
} from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import {
  submitSourceDocument,
  submitSourceDocumentIdempotently,
} from "@/modules/source-document/server/submissions";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import { updateSourceDocuments } from "@/modules/source-document/server/updates";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

async function finalizedFile(body: Buffer) {
  const [id] = await storeProcessedImages([{ bytes: body, contentType: "image/jpeg" }]);
  return { id: id! };
}

/** Attempts waiting in the queue: still processing and not held by a worker. */
async function queuedAttemptIds(db: ReturnType<typeof getTestDb>): Promise<string[]> {
  const rows = await db
    .select({ id: extractionAttempts.id })
    .from(extractionAttempts)
    .where(and(eq(extractionAttempts.status, "processing"), isNull(extractionAttempts.claimToken)));
  return rows.map((row) => row.id);
}

const entry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("target source-document submissions", () => {
  it("creates one document, attempt, and job for concurrent user submissions", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    const submission = {
      bookId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
    };
    const idempotency = {
      principalType: "user" as const,
      principalId: crypto.randomUUID(),
      key: crypto.randomUUID(),
      contentFingerprint: "lunch",
    };

    const results = await Promise.all([
      submitSourceDocumentIdempotently(submission, idempotency),
      submitSourceDocumentIdempotently(submission, idempotency),
    ]);

    const created = results.find((result) => !result.replayed);
    const replayed = results.find((result) => result.replayed);
    if (created?.replayed !== false || replayed?.replayed !== true) {
      throw new Error("Expected one creation and one replay");
    }
    expect(replayed.existing).toEqual({
      sourceDocumentId: created.submission.document.id,
      attemptId: created.submission.attempt.id,
      processingStatus: "processing",
    });
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(extractionAttempts)).toHaveLength(1);
    expect(await queuedAttemptIds(db)).toEqual([created.submission.attempt.id]);
  });

  it("refuses a key reused with other content and scopes keys to their sender", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    const credentialId = crypto.randomUUID();
    await db.insert(serviceCredentials).values({
      id: credentialId,
      name: "idempotency-test",
      tokenHash: "f".repeat(64),
      tokenPrefix: "cashier_test",
      tokenSuffix: "test",
      bookId,
    });
    const submission = {
      bookId,
      input: { text: "receipt", storedFileIds: [], documentDate: null },
    };
    const idempotency = {
      principalType: "credential" as const,
      principalId: credentialId,
      key: "upload-20260926-001",
      contentFingerprint: "first",
    };

    await submitSourceDocumentIdempotently(submission, idempotency);
    await expect(
      submitSourceDocumentIdempotently(submission, { ...idempotency, contentFingerprint: "other" })
    ).rejects.toBeInstanceOf(ConflictError);
    const fromUser = await submitSourceDocumentIdempotently(submission, {
      ...idempotency,
      principalType: "user",
    });

    expect(fromUser.replayed).toBe(false);
    expect(
      await db
        .select({
          source: sourceDocuments.idempotencySource,
          key: sourceDocuments.idempotencyKey,
          fingerprint: sourceDocuments.idempotencyFingerprint,
        })
        .from(sourceDocuments)
    ).toEqual(
      expect.arrayContaining([
        { source: `credential:${credentialId}`, key: idempotency.key, fingerprint: "first" },
        { source: `user:${credentialId}`, key: idempotency.key, fingerprint: "first" },
      ])
    );
  });

  it("atomically creates text, image, and mixed pending attempts with durable intents", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    objectStore.current = new MemoryObjectStore();
    const image = await finalizedFile(Buffer.from("image"));

    const text = await submitSourceDocument({
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    const imageOnly = await submitSourceDocument({
      input: { text: null, storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db),
    });
    const mixed = await submitSourceDocument({
      input: { text: "Mixed", storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db),
    });

    expect(new Set([text.document.id, imageOnly.document.id, mixed.document.id]).size).toBe(3);
    expect(await db.select().from(extractionAttempts)).toHaveLength(3);
    expect(await queuedAttemptIds(db)).toHaveLength(3);
    expect(await db.select().from(sourceDocumentFiles)).toHaveLength(2);
    expect(mixed.job).toMatchObject({
      sourceDocumentId: mixed.document.id,
      attemptId: mixed.attempt.id,
    });
  });

  it("rolls back the document, attempt, and job when the evidence is not a stored file", async () => {
    const db = getTestDb();
    await createTestLedger(db);

    await expect(
      submitSourceDocument({
        input: { text: null, storedFileIds: [crypto.randomUUID()], documentDate: null },
        bookId: await testBookId(db),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(sourceDocuments)).toHaveLength(0);
    expect(await db.select().from(extractionAttempts)).toHaveLength(0);
  });

  it.each([
    ["processing_error", "PROCESSING_UNAVAILABLE"],
    ["invalid_input", null],
  ] as const)(
    "keeps a first %s failure without ledger entries, open to retry or editing by hand",
    async (failureKind, failureCode) => {
      const db = getTestDb();
      await createTestLedger(db);
      const pending = await submitSourceDocument({
        input: { text: "first parse evidence", storedFileIds: [], documentDate: null },
        bookId: await testBookId(db),
      });

      await expect(
        recordProcessingFailure({
          lease: await claimAttemptForTest(pending.attempt.id),
          sourceDocumentId: pending.document.id,
          attemptId: pending.attempt.id,
          failureKind,
          failureMessage: failureKind === "invalid_input" ? "unreadable" : "processing failed",
          ...(failureCode == null ? {} : { failureCode }),
        })
      ).resolves.toBe(true);

      const document = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, pending.document.id),
      });
      expect(document).toMatchObject({
        inputText: "first parse evidence",
        latestAttemptId: pending.attempt.id,
      });
      expect((await getTargetSourceDocument(pending.document.id))?.supportedActions).toEqual([
        "split_entries",
        "retry",
        "edit_retry",
        "delete",
      ]);
      expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    }
  );

  it("preserves active results across failed/anomalous retries and rejects stale activation", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const active = await createTestRecord(getTestDb(), {
      entries: [entry],
      bookId: await testBookId(db),
    });
    const activeEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentId, active.sourceDocumentId),
    });

    const failed = await submitSourceDocument({
      sourceDocumentId: active.sourceDocumentId,
      input: { text: "failed retry", storedFileIds: [], documentDate: null },
      inheritInput: false,
      bookId: await testBookId(db),
    });
    const failedLease = await claimAttemptForTest(failed.attempt.id);
    await recordProcessingFailure({
      lease: failedLease,
      sourceDocumentId: active.sourceDocumentId,
      attemptId: failed.attempt.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });
    const anomalous = await submitSourceDocument({
      sourceDocumentId: active.sourceDocumentId,
      input: { text: "anomalous edit retry", storedFileIds: [], documentDate: null },
      inheritInput: false,
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(anomalous.attempt.id),
      sourceDocumentId: active.sourceDocumentId,
      attemptId: anomalous.attempt.id,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });

    expect(
      await activateAttempt({
        lease: failedLease,
        sourceDocumentId: active.sourceDocumentId,
        attemptId: failed.attempt.id,
        entries: [{ ...entry, amount: "99.00" }],
      })
    ).toBe(false);
    expect(
      await recordProcessingFailure({
        lease: failedLease,
        sourceDocumentId: active.sourceDocumentId,
        attemptId: failed.attempt.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
      })
    ).toBe(false);
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, active.sourceDocumentId),
    });
    expect(document).toMatchObject({
      inputText: "anomalous edit retry",
      latestAttemptId: anomalous.attempt.id,
    });
    expect(
      await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, activeEntry!.id) })
    ).toMatchObject({ amount: "12.500" });
  });

  it("inherits immutable evidence on retry and queues only the retry attempt", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    objectStore.current = new MemoryObjectStore();
    const image = await finalizedFile(Buffer.from("image"));
    const initial = await submitSourceDocument({
      input: { text: "original", storedFileIds: [image.id], documentDate: null },
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(initial.attempt.id),
      sourceDocumentId: initial.document.id,
      attemptId: initial.attempt.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });
    const retry = await submitSourceDocument({
      sourceDocumentId: initial.document.id,
      inheritInput: true,
      bookId: await testBookId(db),
    });

    const retryAttempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, retry.attempt.id),
    });
    const retryDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, retry.document.id),
    });
    const retryFiles = await db.query.sourceDocumentFiles.findMany({
      where: eq(sourceDocumentFiles.sourceDocumentId, retry.document.id),
    });
    expect(retry.document.id).toBe(initial.document.id);
    expect(retryDocument).toMatchObject({
      inputText: "original",
      latestAttemptId: retry.attempt.id,
    });
    expect(retryAttempt?.status).toBe("processing");
    expect(retryFiles.map((file) => file.storedFileId)).toEqual([image.id]);
    expect(await queuedAttemptIds(db)).toEqual([retry.attempt.id]);
  });

  it("rejects inherited evidence retry when the document input exceeds MAX_FILES", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    objectStore.current = new MemoryObjectStore();

    // Create MAX_FILES + 1 finalized stored files
    const body = Buffer.from("tiny");
    const files = await Promise.all(
      Array.from({ length: MAX_FILES + 1 }, () => finalizedFile(body))
    );

    // Create an attempt with MAX_FILES files via the normal path (this succeeds)
    const initial = await submitSourceDocument({
      input: {
        text: "initial",
        storedFileIds: files.slice(0, MAX_FILES).map((f) => f.id),
        documentDate: null,
      },
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(initial.attempt.id),
      sourceDocumentId: initial.document.id,
      attemptId: initial.attempt.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    // Directly insert an extra document file to simulate a pre-existing
    // overflow that predates the aggregate file-count check.
    const overflowFileId = files[MAX_FILES]!.id;
    await db.insert(sourceDocumentFiles).values({
      sourceDocumentId: initial.document.id,
      storedFileId: overflowFileId,
      position: MAX_FILES,
    });

    // Inherited evidence retry should now reject because createProcessingAttemptInTransaction
    // enforces the MAX_FILES limit.
    await expect(
      submitSourceDocument({
        sourceDocumentId: initial.document.id,
        inheritInput: true,
        bookId: await testBookId(db),
      })
    ).rejects.toThrow(ValidationError);
  });

  it("returns ordered stored-file identities without storage details", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    objectStore.current = new MemoryObjectStore();
    const first = await finalizedFile(Buffer.from("first"));
    const second = await finalizedFile(Buffer.from("second"));
    const submitted = await submitSourceDocument({
      input: { text: null, storedFileIds: [second.id, first.id], documentDate: null },
      bookId: await testBookId(db),
    });

    const detail = await getTargetSourceDocument(submitted.document.id);
    expect(detail?.files.map((file) => file.id)).toEqual([second.id, first.id]);
    expect(detail).not.toHaveProperty("imageUrls");
    expect(JSON.stringify(detail)).not.toContain("/api/uploads/");
    expect(JSON.stringify(detail)).not.toContain("storageKey");
  });
});

/**
 * A pool of its own, so a case can hold a transaction open without starving the
 * pool the shared `db` uses for the code under test.
 */
function racePool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
}

/**
 * Takes the ledger row lock the archive and delete paths take, and returns the
 * transaction id other sessions will block on. The id is read from `pg_locks`
 * rather than `pg_current_xact_id()` because only the former is the same 32-bit
 * value a waiter's lock entry names.
 */
async function lockLedgerRow(client: PoolClient): Promise<string> {
  await client.query("BEGIN");
  await client.query("SELECT id FROM ledgers FOR UPDATE");
  const held = await client.query<{ xid: string }>(
    `SELECT transactionid::text AS xid
       FROM pg_locks
      WHERE pid = pg_backend_pid() AND locktype = 'transactionid' AND granted`
  );
  const xid = held.rows[0]?.xid;
  if (xid == null) throw new Error("The blocking transaction holds no row lock");
  return xid;
}

/**
 * Waits until another session is genuinely waiting on the lock `holderXid`
 * holds. Polling the exact blocking transaction — rather than sleeping a fixed
 * time — is what makes the race cases deterministic.
 */
async function waitUntilBlockedOn(pool: Pool, holderXid: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting
         FROM pg_locks
        WHERE NOT granted AND locktype = 'transactionid' AND transactionid::text = $1`,
      [holderXid]
    );
    if (Number(rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the competing transaction to block on the ledger lock");
}

async function expectNoRecordRows(db: ReturnType<typeof getTestDb>): Promise<void> {
  expect(await db.select().from(sourceDocuments)).toHaveLength(0);
  expect(await db.select().from(extractionAttempts)).toHaveLength(0);
}

/**
 * The new-record path resolves its book before the write transaction opens, so
 * only the lock the insert takes can make that choice final. These cases drive
 * the real ports across two connections.
 */
describe("new-record submission against a concurrent archive or ledger delete", () => {
  it("refuses a new record for a book archived before the insert", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const travel = (await createTestBooks(db, ["旅行支出"])).get("旅行支出")!;
    expect(await archiveBook(travel)).toMatchObject({
      status: "archived",
    });

    await expect(
      submitSourceDocument({
        bookId: travel,
        input: { text: "late", storedFileIds: [], documentDate: null },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Book not found" });
    await expectNoRecordRows(db);
  });

  it("refuses a new record for a ledger deleted before the insert", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    await db.delete(ledgers);

    await expect(
      submitSourceDocument({
        bookId,
        input: { text: "late", storedFileIds: [], documentDate: null },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Ledger not found" });
    await expectNoRecordRows(db);
  });

  it("refuses the insert an archive that already holds the ledger lock", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const travel = (await createTestBooks(db, ["旅行支出"])).get("旅行支出")!;
    const pool = racePool();
    const blocker = await pool.connect();
    try {
      const holderXid = await lockLedgerRow(blocker);
      await blocker.query(
        "UPDATE books SET archived_at = now(), updated_at = now() WHERE id = $1",
        [travel]
      );
      const insert = submitSourceDocument({
        bookId: travel,
        input: { text: "late", storedFileIds: [], documentDate: null },
      }).then(
        () => null,
        (error: unknown) => error
      );
      await waitUntilBlockedOn(pool, holderXid);
      await blocker.query("COMMIT");
      expect(await insert).toMatchObject({ code: "NOT_FOUND", message: "Book not found" });
    } finally {
      blocker.release();
      await pool.end();
    }
    await expectNoRecordRows(db);
  });

  it("refuses the insert a ledger delete that already holds the lock", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    const pool = racePool();
    const blocker = await pool.connect();
    try {
      const holderXid = await lockLedgerRow(blocker);
      await blocker.query("DELETE FROM ledgers");
      const insert = submitSourceDocument({
        bookId,
        input: { text: "late", storedFileIds: [], documentDate: null },
      }).then(
        () => null,
        (error: unknown) => error
      );
      await waitUntilBlockedOn(pool, holderXid);
      await blocker.query("COMMIT");
      expect(await insert).toMatchObject({ code: "NOT_FOUND", message: "Ledger not found" });
    } finally {
      blocker.release();
      await pool.end();
    }
    await expectNoRecordRows(db);
  });

  it("makes an archive wait for the insert and still retries the existing record", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const travel = (await createTestBooks(db, ["旅行支出"])).get("旅行支出")!;
    const pool = racePool();
    const holder = await pool.connect();
    const documentId = crypto.randomUUID();
    try {
      // The lock sequence a new submission takes, held open on purpose so the
      // archive is the transaction that has to wait.
      const holderXid = await lockLedgerRow(holder);
      await holder.query("SELECT id FROM books WHERE id = $1 AND archived_at IS NULL FOR SHARE", [
        travel,
      ]);
      await holder.query(
        "INSERT INTO source_documents (id, book_id, document_date, created_at, updated_at)" +
          " VALUES ($1, $2, CURRENT_DATE, now(), now())",
        [documentId, travel]
      );

      const archive = archiveBook(travel).then(
        (result) => result,
        (error: unknown) => error
      );
      await waitUntilBlockedOn(pool, holderXid);
      await holder.query("COMMIT");
      expect(await archive).toMatchObject({ status: "archived" });
    } finally {
      holder.release();
      await pool.end();
    }

    const retry = await submitSourceDocument({
      sourceDocumentId: documentId,
      input: { text: "retry", storedFileIds: [], documentDate: null },
    });
    expect(retry.document.id).toBe(documentId);
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(extractionAttempts)).toHaveLength(1);
    expect(await queuedAttemptIds(db)).toEqual([retry.attempt.id]);
  });

  it("replays a completed idempotent submission without a second document", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const bookId = await testBookId(db);
    const idempotency = {
      principalType: "user" as const,
      principalId: crypto.randomUUID(),
      key: crypto.randomUUID(),
      contentFingerprint: null,
    };
    const submission = {
      bookId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
    };

    const created = await submitSourceDocumentIdempotently(submission, idempotency);
    const replay = await submitSourceDocumentIdempotently(submission, idempotency);

    if (created.replayed || !replay.replayed) throw new Error("Expected a creation, then a replay");
    expect(replay.existing.sourceDocumentId).toBe(created.submission.document.id);
    expect(await db.select().from(sourceDocuments)).toHaveLength(1);
    expect(await db.select().from(extractionAttempts)).toHaveLength(1);
    expect(await queuedAttemptIds(db)).toEqual([created.submission.attempt.id]);
  });
});

describe("the day a new record is filed under", () => {
  async function failProcessing(sourceDocumentId: string, attemptId: string) {
    await recordProcessingFailure({
      lease: await claimAttemptForTest(attemptId),
      sourceDocumentId,
      attemptId,
      failureKind: "invalid_input",
      failureMessage: "unreadable",
    });
  }

  async function filedDay(sourceDocumentId: string) {
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    return document?.documentDate;
  }

  it("is the ledger's today while it processes and after its processing fails", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await db.update(ledgers).set({ timeZone: "Asia/Shanghai" });
    // 07:00 in Shanghai is still the previous day in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-01T23:00:00.000Z") });
    try {
      const created = await submitSourceDocument({
        bookId: await testBookId(db),
        input: { text: "Breakfast 12", storedFileIds: [], documentDate: null },
      });

      expect(await filedDay(created.document.id)).toBe("2026-03-02");
      await failProcessing(created.document.id, created.attempt.id);
      expect(await filedDay(created.document.id)).toBe("2026-03-02");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays the ledger's today after its processing succeeds", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await db.update(ledgers).set({ timeZone: "Asia/Shanghai" });
    // 07:00 in Shanghai is still the previous day in UTC.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-01T23:00:00.000Z") });
    try {
      const created = await submitSourceDocument({
        bookId: await testBookId(db),
        input: { text: "Breakfast 12", storedFileIds: [], documentDate: null },
      });

      expect(
        await activateAttempt({
          lease: await claimAttemptForTest(created.attempt.id),
          sourceDocumentId: created.document.id,
          attemptId: created.attempt.id,
          entries: [entry],
        })
      ).toBe(true);
      expect(await filedDay(created.document.id)).toBe("2026-03-02");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is the day the submission asked for, even when processing fails", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const created = await submitSourceDocument({
      bookId: await testBookId(db),
      input: { text: "Breakfast 12", storedFileIds: [], documentDate: "2026-03-02" },
    });

    expect(await filedDay(created.document.id)).toBe("2026-03-02");
    await failProcessing(created.document.id, created.attempt.id);
    expect(await filedDay(created.document.id)).toBe("2026-03-02");
  });
});

describe("a retry after the owner changed the record by hand", () => {
  async function parsedRecord() {
    const db = getTestDb();
    await createTestLedger(db);
    const created = await submitSourceDocument({
      bookId: await testBookId(db),
      input: { text: "Breakfast 12", storedFileIds: [], documentDate: "2026-03-02" },
    });
    await activateAttempt({
      lease: await claimAttemptForTest(created.attempt.id),
      sourceDocumentId: created.document.id,
      attemptId: created.attempt.id,
      entries: [entry],
    });
    return { db, sourceDocumentId: created.document.id };
  }

  async function completeRetry(sourceDocumentId: string, attemptId: string) {
    return activateAttempt({
      lease: await claimAttemptForTest(attemptId),
      sourceDocumentId,
      attemptId,
      entries: [entry],
    });
  }

  it("keeps the date the owner set after the last parse", async () => {
    const { db, sourceDocumentId } = await parsedRecord();
    await updateSourceDocuments({
      sourceDocumentIds: [sourceDocumentId],
      data: { documentDate: "2026-03-05" },
    });

    const retry = await submitSourceDocument({ sourceDocumentId, inheritInput: true });
    expect(await completeRetry(sourceDocumentId, retry.attempt.id)).toBe(true);

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.documentDate).toBe("2026-03-05");
  });

  it("seeds an edit-and-retry draft with the record's current date", async () => {
    const { sourceDocumentId } = await parsedRecord();
    await updateSourceDocuments({
      sourceDocumentIds: [sourceDocumentId],
      data: { documentDate: "2026-03-05" },
    });

    expect((await getSourceDocumentInput(sourceDocumentId))?.documentDate).toBe("2026-03-05");
  });

  it("keeps the record's date for an edited retry sent without one", async () => {
    const { db, sourceDocumentId } = await parsedRecord();
    await updateSourceDocuments({
      sourceDocumentIds: [sourceDocumentId],
      data: { documentDate: "2026-03-05" },
    });

    const retry = await submitSourceDocument({
      sourceDocumentId,
      supersedeProcessing: true,
      input: { text: "Breakfast 15", storedFileIds: [], documentDate: null },
    });
    await completeRetry(sourceDocumentId, retry.attempt.id);

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.documentDate).toBe("2026-03-05");
  });

  it("refuses a title typed while the record is being parsed", async () => {
    const { db, sourceDocumentId } = await parsedRecord();
    await submitSourceDocument({ sourceDocumentId, inheritInput: true });

    await expect(
      updateSourceDocuments({ sourceDocumentIds: [sourceDocumentId], data: { title: "Mine" } })
    ).rejects.toBeInstanceOf(ConflictError);
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.title).toBeNull();
  });
});
