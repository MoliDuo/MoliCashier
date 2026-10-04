import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { ledgerEntries, ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import { ProcessingCancelledError } from "@/modules/source-document/domain/parse/contracts";

import { setAiTransportForTests } from "@/lib/ai/client";
import { fakeAiTransport, generateVia } from "tests/helpers/fake-ai";
import { processingJobs, attemptProcessor } from "tests/helpers/processing-jobs";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

afterEach(() => {
  setAiTransportForTests(null);
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

describe("processing attempt jobs", () => {
  it("processes parser, reconciliation, exchange-rate facts, and result writes by attempt identity", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const transport = fakeAiTransport(() =>
      JSON.stringify({
        outcome: "success",
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
    const processor = attemptProcessor(generateVia(transport));
    const lease = await claimAttemptForTest(job.attemptId);

    await expect(
      processor.process({
        sourceDocumentId: job.sourceDocumentId,
        attemptId: job.attemptId,
        lease,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ processingStatus: "completed" });
    await expect(
      processor.process({
        sourceDocumentId: job.sourceDocumentId,
        attemptId: job.attemptId,
        lease,
        signal: new AbortController().signal,
      })
    ).rejects.toBeInstanceOf(ProcessingCancelledError);

    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, job.sourceDocumentId) })
    ).resolves.toMatchObject({ latestAttemptId: job.attemptId });
  });

  it("processes with custom ledger prompt in AI generation request", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    // Update typed ledger settings with a custom prompt.
    const customPrompt = "Please categorize expenses as food or transport";
    await db.update(ledgers).set({
      aiCustomPrompt: customPrompt,
      aiLanguage: "en",
      preferredCurrencies: ["CNY", "USD"],
    });

    const transport = fakeAiTransport(() =>
      JSON.stringify({
        outcome: "success",
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

    const processor = attemptProcessor(generateVia(transport));
    const lease = await claimAttemptForTest(job.attemptId);

    await processor.process({
      sourceDocumentId: job.sourceDocumentId,
      attemptId: job.attemptId,
      lease,
      signal: new AbortController().signal,
    });

    // Verify the custom prompt reaches the AI call
    expect(transport.complete).toHaveBeenCalled();
    const callArgs = (transport.complete.mock.calls as unknown[][]).reduce(
      (acc, call) => acc + JSON.stringify(call),
      ""
    );
    expect(callArgs).toContain(customPrompt);
  });

  it("retried attempt uses current ledger settings", async () => {
    const db = getTestDb();
    await insertExchangeRates(new Date().toISOString().slice(0, 10), { CNY: 8, USD: 1.2 });
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    // Process once without custom prompt (successful first parse)
    const transport1 = fakeAiTransport(() =>
      JSON.stringify({
        outcome: "success",
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

    const processor1 = attemptProcessor(generateVia(transport1));

    await processor1.process({
      sourceDocumentId: job.sourceDocumentId,
      attemptId: job.attemptId,
      lease: await claimAttemptForTest(job.attemptId),
      signal: new AbortController().signal,
    });

    // Update typed settings after the first parse.
    const customPrompt = "Please focus on categorizing dining expenses";
    await db.update(ledgers).set({
      aiCustomPrompt: customPrompt,
      aiLanguage: "en",
      preferredCurrencies: ["CNY", "USD"],
    });

    // Create a second attempt (retry) after the settings change
    const bookId = await testBookId(db);
    const pending2 = await createPendingAttempt({
      input: { text: "Dinner 25.00 USD", storedFileIds: [], documentDate: null },
      bookId,
    });

    const transport2 = fakeAiTransport(() =>
      JSON.stringify({
        outcome: "success",
        invalid_reason: null,
        title: "Dinner",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "25.00", currency: "USD" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Dinner",
            amount: "25.00",
            currency: "USD",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      })
    );

    const processor2 = attemptProcessor(generateVia(transport2));

    await processor2.process({
      sourceDocumentId: pending2.document.id,
      attemptId: pending2.attempt.id,
      lease: await claimAttemptForTest(pending2.attempt.id),
      signal: new AbortController().signal,
    });

    // Verify the new AI call used the updated custom prompt
    expect(transport2.complete).toHaveBeenCalled();
    const callArgs = (transport2.complete.mock.calls as unknown[][]).reduce(
      (acc, call) => acc + JSON.stringify(call),
      ""
    );
    expect(callArgs).toContain(customPrompt);
  });

  it("permits only one concurrent claim", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const adapter = processingJobs();

    const claims = await Promise.all([adapter.claim(job.attemptId), adapter.claim(job.attemptId)]);

    const won = claims.filter((claim) => claim != null);
    expect(won).toHaveLength(1);
    expect(won[0]?.job.attemptId).toBe(job.attemptId);
    await expect(
      db.query.extractionAttempts.findFirst({
        where: eq(extractionAttempts.id, job.attemptId),
      })
    ).resolves.toMatchObject({ attemptCount: 1, claimToken: won[0]!.claimToken });
  });

  it("reclaims an expired lease and fences out the previous holder", async () => {
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const adapter = processingJobs();

    const first = await adapter.claim(job.attemptId);
    expect(first).not.toBeNull();
    const renewedUntil = await adapter.renew(job.attemptId, first!.claimToken);
    expect(new Date(renewedUntil!).getTime()).toBeGreaterThanOrEqual(
      new Date(first!.expiresAt).getTime()
    );
    await adapter.expireLease(job.attemptId);
    await expect(adapter.renew(job.attemptId, first!.claimToken)).resolves.toBeNull();
    const second = await adapter.claim(job.attemptId);
    expect(second).not.toBeNull();
    expect(second!.claimToken).not.toBe(first!.claimToken);

    await expect(adapter.renew(job.attemptId, first!.claimToken)).resolves.toBeNull();
    await expect(adapter.renew(job.attemptId, second!.claimToken)).resolves.not.toBeNull();
  });

  it("does not hand out a job whose attempt already finished", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const adapter = processingJobs();
    await db
      .update(extractionAttempts)
      .set({ status: "completed" })
      .where(eq(extractionAttempts.id, job.attemptId));

    await expect(adapter.claim(job.attemptId)).resolves.toBeNull();
  });

  it("returns false on duplicate claim", async () => {
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");
    const adapter = processingJobs();

    // First claim succeeds
    const first = await adapter.claim(job.attemptId);
    expect(first).not.toBeNull();

    // Second claim (same adapter, same DB) returns null since job is claimed
    const second = await adapter.claim(job.attemptId);
    expect(second).toBeNull();
  });

  it("records failed outcome on processing error via executeProcessingJob", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z");

    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new Error("AI service unavailable");
      })
    );

    const result = await executeProcessingJob(job);
    expect(result).toBe(true);

    const row = await db.query.extractionAttempts.findFirst({
      where: eq(extractionAttempts.id, job.attemptId),
    });
    expect(row).toMatchObject({ status: "failed", attemptCount: 1, claimToken: null });
  });
});
