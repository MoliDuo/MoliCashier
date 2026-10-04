import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { sourceDocuments, extractionAttempts } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { processingJobs } from "tests/helpers/processing-jobs";
import { BACKGROUND_MAX_ATTEMPTS } from "@/config/tuning";
import { AppError } from "@/lib/errors";
import { setAiTransportForTests } from "@/lib/ai/client";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { fakeAiTransport } from "tests/helpers/fake-ai";

afterEach(() => {
  setAiTransportForTests(null);
});

/**
 * Creates a processing attempt for a single source document.
 */
async function pendingIntent(
  requestedAt = "2026-07-15T00:00:00.000Z"
): Promise<{ job: ProcessingJobContract }> {
  const db = getTestDb();
  await createTestLedger(db);
  const bookId = await testBookId(db);
  const pending = await createPendingAttempt({
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    bookId: bookId,
  });
  return {
    job: {
      sourceDocumentId: pending.document.id,
      attemptId: pending.attempt.id,
      requestedAt,
    },
  };
}

async function setAttempt(
  attemptId: string,
  values: Partial<typeof extractionAttempts.$inferInsert>
) {
  await getTestDb()
    .update(extractionAttempts)
    .set(values)
    .where(eq(extractionAttempts.id, attemptId));
}

function findAttempt(attemptId: string) {
  return getTestDb().query.extractionAttempts.findFirst({
    where: eq(extractionAttempts.id, attemptId),
  });
}

async function supersede(job: ProcessingJobContract) {
  const db = getTestDb();
  // A retry cancels the attempt it replaces; one document processes one attempt at a time.
  await setAttempt(job.attemptId, { status: "cancelled", finishedAt: new Date() });
  const newAttempt = await db
    .insert(extractionAttempts)
    .values({
      sourceDocumentId: job.sourceDocumentId,
      status: "processing",
    })
    .returning()
    .then((rows) => rows[0]);
  await db
    .update(sourceDocuments)
    .set({ latestAttemptId: newAttempt!.id })
    .where(eq(sourceDocuments.id, job.sourceDocumentId));
  return newAttempt!;
}

describe("Processing Recovery", () => {
  const maxBatch = 3;

  it("recovers an attempt that was submitted but never claimed (the wake was missed)", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();

    const recoverable = await adapter.recoverBatch(maxBatch);

    expect(recoverable.map((candidate) => candidate.attemptId)).toEqual([job.attemptId]);
    // Recovery only reads; a run counts the attempt when it claims it.
    const row = await findAttempt(job.attemptId);
    expect(row?.attemptCount).toBe(0);
    expect(row?.claimToken).toBeNull();
  });

  it("re-selects an attempt with an expired claim", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.attemptId, {
      claimToken: crypto.randomUUID(),
      claimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const recoverable = await adapter.recoverBatch(maxBatch);

    expect(recoverable.map((candidate) => candidate.attemptId)).toEqual([job.attemptId]);
  });

  it("leaves an attempt alone while its claim is live", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    await expect(adapter.claim(job.attemptId)).resolves.not.toBeNull();

    await expect(adapter.recoverBatch(maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.attemptId)).resolves.toBeNull();
  });

  it("does not double-process under concurrent workers", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();

    // Two workers may both see the attempt; only one run can claim it.
    const [first, second] = await Promise.all([
      adapter.recoverBatch(maxBatch),
      adapter.recoverBatch(maxBatch),
    ]);
    expect([...first, ...second].map((candidate) => candidate.attemptId)).toEqual([
      job.attemptId,
      job.attemptId,
    ]);
    const claims = await Promise.all([adapter.claim(job.attemptId), adapter.claim(job.attemptId)]);

    expect(claims.filter((claim) => claim != null)).toHaveLength(1);
    expect((await findAttempt(job.attemptId))!.attemptCount).toBe(1);
    await expect(adapter.recoverBatch(maxBatch)).resolves.toHaveLength(0);
  });

  it("skips recovery when the source document has been deleted", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();

    const db = getTestDb();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, job.sourceDocumentId));

    const recoverable = await adapter.recoverBatch(maxBatch);
    expect(recoverable).toHaveLength(0);
  });

  it("recovers only the attempt that replaced an earlier one", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    const newAttempt = await supersede(job);

    const recoverable = await adapter.recoverBatch(maxBatch);
    expect(recoverable.map((candidate) => candidate.attemptId)).toEqual([newAttempt.id]);
    await expect(adapter.claim(job.attemptId)).resolves.toBeNull();
    const oldAttempt = await findAttempt(job.attemptId);
    expect(oldAttempt?.status).toBe("cancelled");
    expect(oldAttempt?.failureCode).toBeNull();
  });

  it("skips an attempt that already finished", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.attemptId, { status: "completed", finishedAt: new Date() });

    await expect(adapter.recoverBatch(maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.attemptId)).resolves.toBeNull();
    expect((await findAttempt(job.attemptId))?.status).toBe("completed");
  });

  it("counts an attempt each time a run claims the job, not when it is scheduled", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();

    await adapter.recoverBatch(maxBatch);
    await expect(adapter.claim(job.attemptId)).resolves.toMatchObject({ runNumber: 1 });
    await adapter.expireLease(job.attemptId);
    await expect(adapter.claim(job.attemptId)).resolves.toMatchObject({ runNumber: 2 });
  });

  it("does not hand out an attempt before its retry is due", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.attemptId, { nextAttemptAt: new Date(Date.now() + 60_000) });

    await expect(adapter.recoverBatch(maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.attemptId)).resolves.toBeNull();
  });

  it("fails an exhausted job under its lease when a run claims it", async () => {
    const { job } = await pendingIntent();
    const adapter = processingJobs();
    const transport = fakeAiTransport(() => "{}");
    setAiTransportForTests(transport);
    await setAttempt(job.attemptId, { attemptCount: BACKGROUND_MAX_ATTEMPTS });
    const db = getTestDb();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });

    // Recovery still schedules it; the claim is where exhaustion is decided.
    await expect(adapter.recoverBatch(maxBatch)).resolves.toHaveLength(1);
    await expect(executeProcessingJob(job)).resolves.toBe(true);

    expect(transport.complete).not.toHaveBeenCalled();
    await expect(findAttempt(job.attemptId)).resolves.toMatchObject({
      status: "failed",
      failureCode: "request_bound_retry_exhausted",
      attemptCount: BACKGROUND_MAX_ATTEMPTS + 1,
      claimToken: null,
    });
    // A failure changes none of the record's content, so the version stays put.
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, job.sourceDocumentId) })
    ).resolves.toMatchObject({ version: before!.version });
  });

  it("gives a transiently failed attempt back to the queue with a backoff", async () => {
    const { job } = await pendingIntent();
    const rateLimited = new AppError("limited", "ai_rate_limited", 503, { retryAfterMs: 5_000 });
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw rateLimited;
      })
    );

    await expect(executeProcessingJob(job)).resolves.toBe(true);

    const row = await findAttempt(job.attemptId);
    expect(row).toMatchObject({
      status: "processing",
      failureCode: null,
      attemptCount: 1,
      claimToken: null,
    });
    // The provider asked for 5s, longer than the first backoff of 2s.
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3_000);
    await expect(processingJobs().recoverBatch(maxBatch)).resolves.toHaveLength(0);
  });

  it("fails a transient failure on its last attempt with the provider's code", async () => {
    const { job } = await pendingIntent();
    await setAttempt(job.attemptId, { attemptCount: BACKGROUND_MAX_ATTEMPTS - 1 });
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new AppError("down", "ai_provider_unavailable", 503);
      })
    );

    await executeProcessingJob(job);

    await expect(findAttempt(job.attemptId)).resolves.toMatchObject({
      status: "failed",
      failureCode: "ai_provider_unavailable",
      attemptCount: BACKGROUND_MAX_ATTEMPTS,
    });
  });

  it("fails at once when the provider configuration is invalid", async () => {
    const { job } = await pendingIntent();
    const invalid = new AppError("bad key", "ai_configuration_invalid", 500);
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw invalid;
      })
    );

    await executeProcessingJob(job);

    await expect(findAttempt(job.attemptId)).resolves.toMatchObject({
      status: "failed",
      failureCode: "ai_provider_unavailable",
      attemptCount: 1,
    });
  });

  it("returns at most maxBatch intents", async () => {
    await pendingIntent();
    const bookId = await testBookId(getTestDb());
    await createPendingAttempt({
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });
    await createPendingAttempt({
      input: { text: "Coffee 5.00 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });

    const recoverable = await processingJobs().recoverBatch(2);

    // maxBatch=2 limits the result even though 3 intents are eligible
    expect(recoverable).toHaveLength(2);
  });
});

describe("Processing retry supersession", () => {
  it("atomically cancels the old attempt and invalidates its active claim", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const first = await submitSourceDocument({
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    const processing = processingJobs();
    const oldClaim = await processing.claim(first.job.attemptId);
    expect(oldClaim).not.toBeNull();

    const second = await submitSourceDocument({
      sourceDocumentId: first.document.id,
      inheritInput: true,
      supersedeProcessing: true,
      bookId: await testBookId(db),
    });

    const [document, oldAttempt] = await Promise.all([
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.document.id) }),
      db.query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.id, first.attempt.id),
      }),
    ]);

    expect(document?.latestAttemptId).toBe(second.attempt.id);
    expect(oldAttempt?.status).toBe("cancelled");
    await expect(processing.renew(first.job.attemptId, oldClaim!.claimToken)).resolves.toBeNull();
  });
});
