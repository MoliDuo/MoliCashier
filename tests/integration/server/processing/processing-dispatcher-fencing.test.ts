import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { processingJobs, attemptProcessor } from "tests/helpers/processing-jobs";
import { fakeAiTransport, generateVia } from "tests/helpers/fake-ai";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("leased processor fencing", () => {
  async function reclaimedLease(job: ProcessingJobContract) {
    const db = getTestDb();
    const adapter = processingJobs();
    const first = await adapter.claim(job.attemptId);
    expect(first).not.toBeNull();
    // Expire the first claim and let a second worker reclaim the attempt.
    await db
      .update(extractionAttempts)
      .set({ claimExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(extractionAttempts.id, job.attemptId));
    const second = await adapter.claim(job.attemptId);
    expect(second).not.toBeNull();
    return { adapter, firstToken: first!.claimToken, secondToken: second!.claimToken };
  }

  it("does not commit a projection after the worker lease is reclaimed", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const { firstToken } = await reclaimedLease(job);

    const generate = generateVia(
      fakeAiTransport(() =>
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
      )
    );
    const processor = attemptProcessor(generate);

    await expect(
      processor.process({
        signal: new AbortController().signal,
        sourceDocumentId: job.sourceDocumentId,
        attemptId: job.attemptId,
        lease: { attemptId: job.attemptId, claimToken: firstToken },
      })
    ).rejects.toThrow("Processing cancelled");

    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(attempt?.status).toBe("processing");
    expect(document?.latestAttemptId).toBe(job.attemptId);
    expect(document?.version).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("does not persist a terminal outcome after the worker lease is reclaimed", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const { firstToken } = await reclaimedLease(job);

    const generate = generateVia(
      fakeAiTransport(() =>
        JSON.stringify({
          processingStatus: "invalid",
          invalid_reason: "Image too blurry",
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
          reasoning: "blurry image",
        })
      )
    );
    const processor = attemptProcessor(generate);

    await expect(
      processor.process({
        signal: new AbortController().signal,
        sourceDocumentId: job.sourceDocumentId,
        attemptId: job.attemptId,
        lease: { attemptId: job.attemptId, claimToken: firstToken },
      })
    ).rejects.toThrow("Processing cancelled");

    const attempt = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(attempt?.status).toBe("processing");
    expect(attempt?.failureMessage).toBeNull();
    expect(document?.version).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});
