import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { LEASE_DURATION_MS, LEASE_HEARTBEAT_MS } from "@/config/tuning";
import { setAiTransportForTests } from "@/lib/ai/client";
import { fakeAiTransport } from "tests/helpers/fake-ai";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { renewProcessingJobLease } from "@/server/processing/jobs";
import type { ProcessingJobContract } from "@/server/processing/types";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";

vi.mock("@/server/processing/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/processing/jobs")>();
  return { ...actual, renewProcessingJobLease: vi.fn(actual.renewProcessingJobLease) };
});

afterEach(() => {
  setAiTransportForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(renewProcessingJobLease).mockReset();
});

/**
 * Creates a pending attempt + job for a single source document.
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

describe("executeProcessingJob — standalone function with real adapter/processor", () => {
  it.each([
    ["returns null", "null"],
    ["throws", "throw"],
  ] as const)("aborts the worker when lease renewal %s", async (_label, mode) => {
    vi.useFakeTimers();
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    let releaseGeneration!: (value: { content: string }) => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generation = new Promise<{ content: string }>((resolve) => {
      releaseGeneration = resolve;
    });
    let processingSignal: AbortSignal | undefined;
    setAiTransportForTests(
      fakeAiTransport((request) => {
        processingSignal = request.signal;
        markGenerationStarted();
        return generation;
      })
    );

    const renew = vi.mocked(renewProcessingJobLease).mockImplementation(async () => {
      if (mode === "null") return null;
      throw new Error("lease backend unavailable");
    });
    const execution = executeProcessingJob(job);
    await generationStarted;
    // A lost lease stops the work at once; a renewal that keeps failing is retried on each
    // heartbeat and stops it only before the lease, as last renewed, runs out.
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    if (mode === "throw") {
      expect(processingSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(LEASE_DURATION_MS - LEASE_HEARTBEAT_MS);
    }

    expect(renew).toHaveBeenCalledTimes(mode === "null" ? 1 : 2);
    expect(processingSignal?.aborted).toBe(true);

    releaseGeneration({
      content: JSON.stringify({
        processingStatus: "success",
        invalid_reason: null,
        title: "Lunch",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "12.50", currency: "CNY" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Lunch",
            amount: "12.50",
            currency: "CNY",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      }),
    });

    await expect(execution).resolves.toBe(true);
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    expect(document?.latestAttemptId).toBe(job.attemptId);
    expect(attempt?.status).toBe("processing");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("processes successfully, completing the attempt and releasing its claim", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    const transport = fakeAiTransport(() =>
      JSON.stringify({
        processingStatus: "success",
        invalid_reason: null,
        title: "Lunch",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "12.50", currency: "CNY" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Lunch",
            amount: "12.50",
            currency: "CNY",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      })
    );
    setAiTransportForTests(transport);

    const result = await executeProcessingJob(job);
    expect(result).toBe(true);

    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(doc?.latestAttemptId).toBe(job.attemptId);
    expect(doc?.version).toBe(2);

    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    expect(attempt).toMatchObject({
      status: "completed",
      attemptCount: 1,
      claimToken: null,
      claimExpiresAt: null,
    });

    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("does not run a job whose attempt was superseded", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    const transport = fakeAiTransport(() => {
      throw new Error("AI service unavailable");
    });
    setAiTransportForTests(transport);

    // Simulate a retry: it cancels the attempt it replaces and points the
    // document at the new one.
    await db
      .update(extractionAttempts)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(extractionAttempts.id, job.attemptId));
    const newAttemptId = crypto.randomUUID();
    await db.insert(extractionAttempts).values({
      id: newAttemptId,
      sourceDocumentId: job.sourceDocumentId,
      status: "processing",
    });
    await db
      .update(sourceDocuments)
      .set({ latestAttemptId: newAttemptId })
      .where(eq(sourceDocuments.id, job.sourceDocumentId));

    const result = await executeProcessingJob(job);
    expect(result).toBe(false);
    expect(transport.complete).not.toHaveBeenCalled();

    // The claim refuses the superseded attempt without counting a run.
    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    expect(attempt).toMatchObject({
      status: "cancelled",
      attemptCount: 0,
      claimToken: null,
    });

    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});
