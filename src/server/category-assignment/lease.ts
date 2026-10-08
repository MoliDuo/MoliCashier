import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
} from "@/persistence";
import type {
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentMode,
} from "@/modules/ledger/contracts";
import { databaseClockPlus, leaseExpiry, leaseFree, leaseHeldBy } from "@/lib/db/lease";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { rowMode } from "./reads";

/**
 * What a worker does under a job's lease: claim it, renew it, take the next due
 * document, record each document's outcome, and finish or release the job. Every
 * write fences on the lease, so a worker whose lease has lapsed writes nothing.
 */

/** The lease a worker holds on a job; every write the run makes fences on it. */
export interface CategoryAssignmentLease {
  jobId: string;
  claimToken: string;
}

export interface ClaimedCategoryAssignmentJob extends CategoryAssignmentLease {
  mode: CategoryAssignmentMode;
  candidates: CategoryAssignmentCandidateSnapshot[];
  customPrompt: string | null;
  learnedPreferences: string | null;
}

/** A document the run picked up; `runNumber` already counts this one. */
export interface CategoryAssignmentDocumentWork {
  sourceDocumentId: string;
  runNumber: number;
  completedChunkCount: number;
  lastErrorCode: string | null;
}

export type NextCategoryAssignmentDocument =
  | { kind: "document"; document: CategoryAssignmentDocumentWork }
  /** Documents are left, but none is due for this long. */
  | { kind: "wait"; delayMs: number }
  /** Every document has its outcome. */
  | { kind: "done" }
  | { kind: "lost" };

const jobLeaseHeldBy = (claimToken: string) =>
  leaseHeldBy(categoryAssignmentJobs.claimToken, categoryAssignmentJobs.claimExpiresAt, claimToken);

/**
 * Runs `work` in a transaction that holds the job row locked, or returns null
 * when the lease is no longer this worker's. Taking the job row lock first is
 * what orders a run's writes against a cancel and against the next worker.
 */
async function withHeldJob<T>(
  lease: CategoryAssignmentLease,
  work: (tx: PostgresTransaction) => Promise<T>
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const held = await tx
      .select({ id: categoryAssignmentJobs.id })
      .from(categoryAssignmentJobs)
      .where(and(eq(categoryAssignmentJobs.id, lease.jobId), jobLeaseHeldBy(lease.claimToken)))
      .for("update")
      .then((rows) => rows[0]);
    if (held == null) return null;
    return work(tx);
  });
}

/**
 * Leases one job that has work: a document that is due, or no document left
 * at all, so a run that died after its last document still gets its final
 * status. Only one job is active at a time, so this is also only one worker.
 */
export async function claimCategoryAssignmentJob(
  scope: { jobId?: string } = {}
): Promise<ClaimedCategoryAssignmentJob | null> {
  const token = crypto.randomUUID();
  const claimed = await db.execute<{
    id: string;
    mode: "ai" | "assign" | "clear";
    assign_category_id: string | null;
    candidate_snapshot: CategoryAssignmentCandidateSnapshot[];
    custom_prompt_snapshot: string | null;
    learned_preferences_snapshot: string | null;
  }>(sql`
    WITH candidate AS (
      SELECT job.id FROM ${categoryAssignmentJobs} AS job
      WHERE job.status IN ('pending', 'running')
        AND ${leaseFree(sql`job.claim_token`, sql`job.claim_expires_at`)}
        AND (
          EXISTS (
            SELECT 1 FROM ${categoryAssignmentDocuments} AS work
            WHERE work.job_id = job.id
              AND work.status = 'pending' AND work.next_attempt_at <= clock_timestamp()
          )
          OR NOT EXISTS (
            SELECT 1 FROM ${categoryAssignmentDocuments} AS work
            WHERE work.job_id = job.id AND work.status = 'pending'
          )
        )
        ${scope.jobId == null ? sql`` : sql`AND job.id = ${scope.jobId}`}
      ORDER BY job.created_at, job.id
      LIMIT 1
      FOR UPDATE OF job SKIP LOCKED
    )
    UPDATE ${categoryAssignmentJobs} AS job
    SET status = 'running', claim_token = ${token}, claim_expires_at = ${leaseExpiry()},
        updated_at = ${new Date()}
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id, job.mode, job.assign_category_id,
      job.candidate_snapshot, job.custom_prompt_snapshot,
      job.learned_preferences_snapshot
  `);
  const row = claimed.rows[0];
  if (row == null) return null;
  return {
    jobId: row.id,
    claimToken: token,
    mode: rowMode({
      mode: row.mode,
      assignCategoryId: row.assign_category_id,
      candidateSnapshot: row.candidate_snapshot,
    }),
    candidates: row.candidate_snapshot,
    customPrompt: row.custom_prompt_snapshot,
    learnedPreferences: row.learned_preferences_snapshot,
  };
}

export async function renewCategoryAssignmentLease(
  lease: CategoryAssignmentLease
): Promise<boolean> {
  const rows = await db
    .update(categoryAssignmentJobs)
    .set({ claimExpiresAt: leaseExpiry() })
    .where(and(eq(categoryAssignmentJobs.id, lease.jobId), jobLeaseHeldBy(lease.claimToken)))
    .returning({ id: categoryAssignmentJobs.id });
  return rows.length === 1;
}

/** Picks the job's next due document and counts the attempt on it. */
export async function nextCategoryAssignmentDocument(
  lease: CategoryAssignmentLease
): Promise<NextCategoryAssignmentDocument> {
  const next = await withHeldJob(lease, async (tx): Promise<NextCategoryAssignmentDocument> => {
    const picked = await tx.execute<{
      source_document_id: string;
      attempt_count: number;
      completed_chunk_count: number;
      error_code: string | null;
    }>(sql`
      UPDATE ${categoryAssignmentDocuments} AS work
      SET attempt_count = work.attempt_count + 1, updated_at = ${new Date()}
      WHERE (work.job_id, work.source_document_id) = (
        SELECT due.job_id, due.source_document_id
        FROM ${categoryAssignmentDocuments} AS due
        WHERE due.job_id = ${lease.jobId}
          AND due.status = 'pending' AND due.next_attempt_at <= clock_timestamp()
        ORDER BY due.next_attempt_at, due.selection_order
        LIMIT 1
      )
      RETURNING work.source_document_id, work.attempt_count, work.completed_chunk_count,
        work.error_code
    `);
    const row = picked.rows[0];
    if (row != null) {
      return {
        kind: "document",
        document: {
          sourceDocumentId: row.source_document_id,
          runNumber: Number(row.attempt_count),
          completedChunkCount: Number(row.completed_chunk_count),
          lastErrorCode: row.error_code,
        },
      };
    }
    const waiting = await tx.execute<{ delay_ms: string | null }>(sql`
      SELECT ceil(extract(epoch FROM min(next_attempt_at) - clock_timestamp()) * 1000)::text
        AS delay_ms
      FROM ${categoryAssignmentDocuments}
      WHERE job_id = ${lease.jobId} AND status = 'pending'
    `);
    const delayMs = waiting.rows[0]?.delay_ms;
    return delayMs == null
      ? { kind: "done" }
      : { kind: "wait", delayMs: Math.max(0, Number(delayMs)) };
  });
  return next ?? { kind: "lost" };
}

export async function loadCategoryAssignmentSelection(input: {
  jobId: string;
  sourceDocumentId: string;
}): Promise<string[]> {
  const entries = await db
    .select({ id: categoryAssignmentEntries.ledgerEntryId })
    .from(categoryAssignmentEntries)
    .where(
      and(
        eq(categoryAssignmentEntries.jobId, input.jobId),
        eq(categoryAssignmentEntries.sourceDocumentId, input.sourceDocumentId)
      )
    )
    .orderBy(categoryAssignmentEntries.selectionOrder);
  return entries.map((entry) => entry.id);
}

function documentWhere(lease: CategoryAssignmentLease, sourceDocumentId: string) {
  return and(
    eq(categoryAssignmentDocuments.jobId, lease.jobId),
    eq(categoryAssignmentDocuments.sourceDocumentId, sourceDocumentId)
  );
}

export async function markCategoryAssignmentEvidenceIncomplete(
  lease: CategoryAssignmentLease,
  sourceDocumentId: string
): Promise<void> {
  await withHeldJob(lease, (tx) =>
    tx
      .update(categoryAssignmentDocuments)
      .set({ evidenceIncomplete: true, updatedAt: new Date() })
      .where(documentWhere(lease, sourceDocumentId))
  );
}

/**
 * Stores one request block's decisions and moves the document's checkpoint
 * past it, so a later attempt resumes after the blocks already paid for.
 */
export async function persistCategoryAssignmentDecisions(input: {
  lease: CategoryAssignmentLease;
  sourceDocumentId: string;
  decisions: readonly { ledgerEntryId: string; categoryId: string }[];
  completedChunkCount: number;
}): Promise<boolean> {
  const { lease } = input;
  const now = new Date();
  const persisted = await withHeldJob(lease, async (tx) => {
    if (input.decisions.length > 0) {
      // Decisions are unique per entry, so every one must land on an entry
      // of this block that has no outcome yet.
      const updated = await tx.execute(sql`
        UPDATE ${categoryAssignmentEntries} AS work
        SET target_category_id = decision.category_id, decision_persisted = true,
            updated_at = ${now}
        FROM (VALUES ${sql.join(
          input.decisions.map(
            (decision) => sql`(${decision.ledgerEntryId}::uuid, ${decision.categoryId}::uuid)`
          ),
          sql`, `
        )}) AS decision(ledger_entry_id, category_id)
        WHERE work.job_id = ${lease.jobId}
          AND work.source_document_id = ${input.sourceDocumentId}
          AND work.ledger_entry_id = decision.ledger_entry_id
          AND work.outcome IS NULL
        RETURNING work.ledger_entry_id
      `);
      if (updated.rows.length !== input.decisions.length)
        throw new ConflictError("AI returned an entry outside the claimed request block");
    }
    await tx
      .update(categoryAssignmentDocuments)
      .set({ completedChunkCount: input.completedChunkCount, updatedAt: now })
      .where(documentWhere(lease, input.sourceDocumentId));
    return true;
  });
  return persisted === true;
}

/**
 * Hands a document back uncounted when the run's budget ends between request
 * blocks: stopping on time is not a failed attempt, and the checkpoint keeps
 * the blocks already done.
 */
export async function yieldCategoryAssignmentDocument(
  lease: CategoryAssignmentLease,
  sourceDocumentId: string
): Promise<void> {
  await withHeldJob(lease, (tx) =>
    tx
      .update(categoryAssignmentDocuments)
      .set({
        attemptCount: sql`greatest(${categoryAssignmentDocuments.attemptCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(documentWhere(lease, sourceDocumentId))
  );
}

/** Puts a document back to wait out a transient failure. */
export async function rescheduleCategoryAssignmentDocument(input: {
  lease: CategoryAssignmentLease;
  sourceDocumentId: string;
  errorCode: string;
  delayMs: number;
}): Promise<boolean> {
  const done = await withHeldJob(input.lease, async (tx) => {
    await tx
      .update(categoryAssignmentDocuments)
      .set({
        nextAttemptAt: databaseClockPlus(input.delayMs),
        errorCode: input.errorCode,
        updatedAt: new Date(),
      })
      .where(documentWhere(input.lease, input.sourceDocumentId));
    return true;
  });
  return done === true;
}

/** Fails a document and every entry on it that has no outcome yet. */
export async function failCategoryAssignmentDocument(input: {
  lease: CategoryAssignmentLease;
  sourceDocumentId: string;
  errorCode: string;
}): Promise<boolean> {
  const { lease } = input;
  const now = new Date();
  const done = await withHeldJob(lease, async (tx) => {
    await tx
      .update(categoryAssignmentDocuments)
      .set({ status: "failed", errorCode: input.errorCode, updatedAt: now })
      .where(documentWhere(lease, input.sourceDocumentId));
    await tx
      .update(categoryAssignmentEntries)
      .set({ outcome: "failed", errorCode: input.errorCode, updatedAt: now })
      .where(
        and(
          eq(categoryAssignmentEntries.jobId, lease.jobId),
          eq(categoryAssignmentEntries.sourceDocumentId, input.sourceDocumentId),
          isNull(categoryAssignmentEntries.outcome)
        )
      );
    return true;
  });
  return done === true;
}

/**
 * Settles a job whose documents all have their outcome: its status follows
 * from its entries' outcomes, and the lease is dropped with it. A job with
 * documents still pending is left as it is.
 */
export async function finishCategoryAssignmentJobIfDone(
  tx: PostgresTransaction,
  jobId: string
): Promise<boolean> {
  const result = await tx.execute<{
    pending: boolean;
    applied: string;
    confirmed: string;
    failed: string;
    conflict: string;
    skipped: string;
    cancelled: string;
  }>(sql`
    SELECT
      EXISTS (
        SELECT 1 FROM ${categoryAssignmentDocuments}
        WHERE job_id = ${jobId} AND status = 'pending'
      ) AS pending,
      count(*) FILTER (WHERE outcome = 'applied')::text AS applied,
      count(*) FILTER (WHERE outcome = 'confirmed')::text AS confirmed,
      count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
      count(*) FILTER (WHERE outcome = 'conflict')::text AS conflict,
      count(*) FILTER (WHERE outcome = 'skipped')::text AS skipped,
      count(*) FILTER (WHERE outcome = 'cancelled')::text AS cancelled
    FROM ${categoryAssignmentEntries}
    WHERE job_id = ${jobId}
  `);
  const row = result.rows[0]!;
  if (row.pending) return false;
  const successful = Number(row.applied) + Number(row.confirmed);
  const failed = Number(row.failed);
  const unapplied = Number(row.conflict) + Number(row.skipped);
  const status =
    Number(row.cancelled) > 0
      ? "cancelled"
      : failed + unapplied === 0
        ? "succeeded"
        : successful === 0 && failed > 0 && unapplied === 0
          ? "failed"
          : "partial";
  const now = new Date();
  await tx
    .update(categoryAssignmentJobs)
    .set({ status, claimToken: null, claimExpiresAt: null, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(categoryAssignmentJobs.id, jobId),
        inArray(categoryAssignmentJobs.status, ["pending", "running"])
      )
    );
  return true;
}

/**
 * Gives the job back when the run stops. A job with no document left gets its
 * final status in the same transaction; otherwise the next run claims it once
 * a document is due.
 */
export async function releaseCategoryAssignmentJob(lease: CategoryAssignmentLease): Promise<void> {
  await withHeldJob(lease, async (tx) => {
    if (await finishCategoryAssignmentJobIfDone(tx, lease.jobId)) return;
    await tx
      .update(categoryAssignmentJobs)
      .set({ claimToken: null, claimExpiresAt: null })
      .where(eq(categoryAssignmentJobs.id, lease.jobId));
  });
}
