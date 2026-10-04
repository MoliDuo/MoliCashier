import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import type {
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentEntryResultDto,
  CategoryAssignmentEntryStatesDto,
  CategoryAssignmentMode,
  CategoryAssignmentResultPageDto,
} from "@/modules/ledger/contracts";
import { databaseClockPlus, leaseExpiry, leaseFree, leaseHeldBy } from "@/lib/db/lease";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

/** Rows per insert statement, well inside PostgreSQL's bind parameter limit. */
const INSERT_BATCH_SIZE = 1000;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function violatesConstraint(error: unknown, constraint: string): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505" &&
      "constraint" in candidate &&
      (candidate as { constraint?: unknown }).constraint === constraint
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

function modeColumns(mode: CategoryAssignmentMode) {
  return {
    mode: mode.kind,
    assignCategoryId: mode.kind === "assign" ? mode.categoryId : null,
  } as const;
}

/** The mode a job was started with; an `ai` run's candidates are its snapshot. */
export function rowMode(row: {
  mode: "ai" | "assign" | "clear";
  assignCategoryId: string | null;
  candidateSnapshot: ReadonlyArray<{ id: string }>;
}): CategoryAssignmentMode {
  if (row.mode === "assign") return { kind: "assign", categoryId: row.assignCategoryId! };
  if (row.mode === "clear") return { kind: "clear" };
  return {
    kind: "ai",
    candidateCategoryIds: row.candidateSnapshot.map((candidate) => candidate.id),
  };
}

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += INSERT_BATCH_SIZE) {
    result.push(items.slice(offset, offset + INSERT_BATCH_SIZE));
  }
  return result;
}

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
 * Registers a run over the given entries in one transaction: the job, one row
 * per document, and one per entry. The server resolves each entry's document,
 * so a selection is only ever what the ledger holds right now. Replaying the
 * same request key returns the run it created; reusing it for a different
 * selection is a conflict.
 */
export async function startCategoryAssignment(input: {
  requestKey: string;
  mode: CategoryAssignmentMode;
  ledgerEntryIds: readonly string[];
  candidates: CategoryAssignmentCandidateSnapshot[];
  customPrompt: string | null;
  learnedPreferences?: string | null;
  retryOfJobId?: string;
  now?: Date;
}): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  const entryIds = [...new Set(input.ledgerEntryIds)];
  try {
    return await db.transaction(async (tx) => {
      await lockLedgerForUpdate(tx);
      const replay = await tx
        .select()
        .from(categoryAssignmentJobs)
        .where(eq(categoryAssignmentJobs.requestKey, input.requestKey))
        .then((rows) => rows[0]);
      if (replay != null) {
        const selected = await tx
          .select({ id: categoryAssignmentEntries.ledgerEntryId })
          .from(categoryAssignmentEntries)
          .where(eq(categoryAssignmentEntries.jobId, replay.id))
          .orderBy(categoryAssignmentEntries.selectionOrder);
        if (
          !sameJson(rowMode(replay), input.mode) ||
          !sameJson(replay.candidateSnapshot, input.candidates) ||
          !sameJson(
            selected.map((row) => row.id),
            entryIds
          )
        ) {
          throw new ConflictError(
            "Category assignment request key was reused with different input"
          );
        }
        return { id: replay.id };
      }

      const rows = await tx
        .select({
          id: ledgerEntries.id,
          categoryId: ledgerEntries.categoryId,
          sourceDocumentId: sourceDocuments.id,
        })
        .from(ledgerEntries)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
        .where(inArray(ledgerEntries.id, entryIds));
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (byId.size !== entryIds.length) {
        throw new ValidationError("Selection contains unavailable entries");
      }
      if (input.mode.kind === "assign") {
        const category = await tx
          .select({ id: entryCategories.id })
          .from(entryCategories)
          .where(eq(entryCategories.id, input.mode.categoryId))
          .then((result) => result[0]);
        if (category == null) throw new ConflictError("Target category changed before the start");
      }

      const [created] = await tx
        .insert(categoryAssignmentJobs)
        .values({
          status: "pending",
          requestKey: input.requestKey,
          candidateSnapshot: input.candidates,
          customPromptSnapshot: input.customPrompt,
          learnedPreferencesSnapshot: input.learnedPreferences ?? null,
          retryOfJobId: input.retryOfJobId ?? null,
          ...modeColumns(input.mode),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: categoryAssignmentJobs.id });
      if (created == null) throw new ConflictError("Category assignment could not be created");

      const selectionOrder = new Map<string, number>();
      entryIds.forEach((id, index) => {
        const documentId = byId.get(id)!.sourceDocumentId;
        if (!selectionOrder.has(documentId)) selectionOrder.set(documentId, index);
      });
      for (const batch of batches([...selectionOrder])) {
        await tx.insert(categoryAssignmentDocuments).values(
          batch.map(([sourceDocumentId, order]) => ({
            jobId: created.id,
            sourceDocumentId,
            selectionOrder: order,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          }))
        );
      }
      // Assigning and clearing need no model: their decision is known now.
      const decided = input.mode.kind !== "ai";
      const targetCategoryId = input.mode.kind === "assign" ? input.mode.categoryId : null;
      for (const batch of batches(entryIds.map((id, index) => ({ id, index })))) {
        await tx.insert(categoryAssignmentEntries).values(
          batch.map(({ id, index }) => {
            const row = byId.get(id)!;
            return {
              jobId: created.id,
              ledgerEntryId: id,
              sourceDocumentId: row.sourceDocumentId,
              selectionOrder: index,
              originalCategoryId: row.categoryId,
              targetCategoryId: decided ? targetCategoryId : null,
              decisionPersisted: decided,
              createdAt: now,
              updatedAt: now,
            };
          })
        );
      }
      return created;
    });
  } catch (error) {
    if (violatesConstraint(error, "uq_category_assignment_jobs_active")) {
      throw new ConflictError("A category assignment is already active for this ledger");
    }
    throw error;
  }
}

export async function resolveLatestConflictSelection(input: { jobId: string }) {
  const original = await db
    .select()
    .from(categoryAssignmentJobs)
    .where(
      and(
        eq(categoryAssignmentJobs.id, input.jobId),
        inArray(categoryAssignmentJobs.status, ["partial", "failed", "cancelled"]),
        sql`EXISTS (
          SELECT 1 FROM ${categoryAssignmentEntries} AS entry
          WHERE entry.job_id = ${categoryAssignmentJobs.id}
            AND entry.outcome = 'conflict'
        )`
      )
    )
    .then((rows) => rows[0]);
  if (original == null) {
    throw new ValidationError("This assignment has no conflicts to categorize again");
  }
  const entries = await db
    .select({ ledgerEntryId: ledgerEntries.id })
    .from(categoryAssignmentEntries)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, categoryAssignmentEntries.ledgerEntryId))
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(
      and(
        eq(categoryAssignmentEntries.jobId, input.jobId),
        eq(categoryAssignmentEntries.outcome, "conflict")
      )
    )
    .orderBy(categoryAssignmentEntries.selectionOrder);
  if (entries.length === 0) {
    throw new ValidationError(
      "Conflicted entries are no longer current; select their replacements from Details"
    );
  }
  return {
    mode: rowMode(original),
    retryOfJobId: original.id,
    ledgerEntryIds: entries.map((entry) => entry.ledgerEntryId),
  };
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

export async function cancelCategoryAssignment(input: {
  jobId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    // Dropping the lease is what stops a worker mid-run: its next write finds
    // the lease gone and discards what it was about to store.
    const changed = await tx
      .update(categoryAssignmentJobs)
      .set({
        status: "cancelled",
        claimToken: null,
        claimExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(categoryAssignmentJobs.id, input.jobId),
          inArray(categoryAssignmentJobs.status, ["pending", "running"])
        )
      )
      .returning({ id: categoryAssignmentJobs.id });
    if (changed.length === 0) return false;
    await tx
      .update(categoryAssignmentEntries)
      .set({ outcome: "cancelled", errorCode: null, updatedAt: now })
      .where(
        and(
          eq(categoryAssignmentEntries.jobId, input.jobId),
          isNull(categoryAssignmentEntries.outcome)
        )
      );
    await tx
      .update(categoryAssignmentDocuments)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(categoryAssignmentDocuments.jobId, input.jobId),
          eq(categoryAssignmentDocuments.status, "pending")
        )
      );
    return true;
  });
}

export async function retryCategoryAssignmentFailures(input: {
  jobId: string;
  requestKey: string;
  now?: Date;
}): Promise<{ id: string }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const replay = await tx
      .select({ id: categoryAssignmentJobs.id })
      .from(categoryAssignmentJobs)
      .where(eq(categoryAssignmentJobs.requestKey, input.requestKey))
      .then((rows) => rows[0]);
    if (replay != null) return replay;
    const original = await tx
      .select()
      .from(categoryAssignmentJobs)
      .where(
        and(
          eq(categoryAssignmentJobs.id, input.jobId),
          inArray(categoryAssignmentJobs.status, ["partial", "failed"])
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    const failedEntries =
      original == null
        ? []
        : await tx
            .select()
            .from(categoryAssignmentEntries)
            .where(
              and(
                eq(categoryAssignmentEntries.jobId, input.jobId),
                eq(categoryAssignmentEntries.outcome, "failed")
              )
            )
            .orderBy(categoryAssignmentEntries.selectionOrder);
    if (original == null || failedEntries.length === 0) {
      throw new ValidationError("This assignment has no retryable failures");
    }
    const failedDocuments = await tx
      .select({ work: categoryAssignmentDocuments, current: sourceDocuments })
      .from(categoryAssignmentDocuments)
      .leftJoin(
        sourceDocuments,
        eq(sourceDocuments.id, categoryAssignmentDocuments.sourceDocumentId)
      )
      .where(
        and(
          eq(categoryAssignmentDocuments.jobId, input.jobId),
          eq(categoryAssignmentDocuments.status, "failed")
        )
      )
      .orderBy(categoryAssignmentDocuments.selectionOrder);
    const [created] = await tx
      .insert(categoryAssignmentJobs)
      .values({
        status: "pending",
        mode: original.mode,
        assignCategoryId: original.assignCategoryId,
        candidateSnapshot: original.candidateSnapshot,
        customPromptSnapshot: original.customPromptSnapshot,
        learnedPreferencesSnapshot: original.learnedPreferencesSnapshot,
        requestKey: input.requestKey,
        retryOfJobId: original.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: categoryAssignmentJobs.id });
    if (created == null) throw new ConflictError("Retry assignment could not be created");
    const changedDocuments = new Set(
      failedDocuments
        .filter(({ current }) => current == null)
        .map(({ work }) => work.sourceDocumentId)
    );
    for (const batch of batches(failedDocuments)) {
      await tx.insert(categoryAssignmentDocuments).values(
        batch.map(({ work }) => {
          const changed = changedDocuments.has(work.sourceDocumentId);
          return {
            jobId: created.id,
            sourceDocumentId: work.sourceDocumentId,
            selectionOrder: work.selectionOrder,
            status: changed ? ("conflict" as const) : ("pending" as const),
            completedChunkCount: changed ? 0 : work.completedChunkCount,
            nextAttemptAt: now,
            errorCode: changed ? "document_changed" : null,
            createdAt: now,
            updatedAt: now,
          };
        })
      );
    }
    for (const batch of batches(failedEntries)) {
      await tx.insert(categoryAssignmentEntries).values(
        batch.map((entry) => {
          const changed = changedDocuments.has(entry.sourceDocumentId);
          return {
            jobId: created.id,
            ledgerEntryId: entry.ledgerEntryId,
            sourceDocumentId: entry.sourceDocumentId,
            selectionOrder: entry.selectionOrder,
            originalCategoryId: entry.originalCategoryId,
            targetCategoryId: changed ? null : entry.targetCategoryId,
            decisionPersisted: !changed && entry.decisionPersisted,
            outcome: changed ? ("conflict" as const) : null,
            errorCode: changed ? "document_changed" : null,
            createdAt: now,
            updatedAt: now,
          };
        })
      );
    }
    await finishCategoryAssignmentJobIfDone(tx, created.id);
    return created;
  });
}

export async function listCategoryAssignmentResults(input: {
  jobId: string;
  cursor?: number;
  limit?: number;
}): Promise<CategoryAssignmentResultPageDto> {
  const cursor = input.cursor ?? 0;
  const limit = Math.min(input.limit ?? 50, 50);
  const rows = await db
    .select({
      ledgerEntryId: categoryAssignmentEntries.ledgerEntryId,
      itemName: ledgerEntries.itemName,
      originalCategoryId: categoryAssignmentEntries.originalCategoryId,
      targetCategoryId: categoryAssignmentEntries.targetCategoryId,
      outcome: categoryAssignmentEntries.outcome,
      errorCode: categoryAssignmentEntries.errorCode,
      selectionOrder: categoryAssignmentEntries.selectionOrder,
    })
    .from(categoryAssignmentEntries)
    .leftJoin(ledgerEntries, eq(ledgerEntries.id, categoryAssignmentEntries.ledgerEntryId))
    .where(
      and(
        eq(categoryAssignmentEntries.jobId, input.jobId),
        sql`${categoryAssignmentEntries.selectionOrder} >= ${cursor}`
      )
    )
    .orderBy(categoryAssignmentEntries.selectionOrder)
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const categoryIds = [
    ...new Set(
      page.flatMap((row) => [row.originalCategoryId, row.targetCategoryId]).filter(Boolean)
    ),
  ] as string[];
  const categories =
    categoryIds.length === 0
      ? []
      : await db
          .select({ id: entryCategories.id, name: entryCategories.name })
          .from(entryCategories)
          .where(inArray(entryCategories.id, categoryIds));
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const items: CategoryAssignmentEntryResultDto[] = page.map((row) => ({
    ledgerEntryId: row.ledgerEntryId,
    itemName: row.itemName,
    originalCategoryId: row.originalCategoryId,
    originalCategoryName:
      row.originalCategoryId == null ? null : (names.get(row.originalCategoryId) ?? null),
    targetCategoryId: row.targetCategoryId,
    targetCategoryName:
      row.targetCategoryId == null ? null : (names.get(row.targetCategoryId) ?? null),
    outcome: row.outcome,
    errorCode: row.errorCode,
  }));
  return {
    items,
    nextCursor: rows.length > limit ? rows[limit]!.selectionOrder : null,
  };
}

/**
 * The entries of a run a row has something to say about: those still waiting for
 * the model, and those the model could not place. A failure is only reported
 * while the entry still sits in the category it had when the run was selected,
 * so a row the reader has since fixed by hand stops being flagged. Entries the
 * run settled are not listed, which keeps the answer short for a large run.
 */
export async function listCategoryAssignmentEntryStates(input: {
  jobId: string;
}): Promise<CategoryAssignmentEntryStatesDto> {
  const rows = await db
    .select({
      ledgerEntryId: categoryAssignmentEntries.ledgerEntryId,
      outcome: categoryAssignmentEntries.outcome,
    })
    .from(categoryAssignmentEntries)
    .leftJoin(ledgerEntries, eq(ledgerEntries.id, categoryAssignmentEntries.ledgerEntryId))
    .where(
      and(
        eq(categoryAssignmentEntries.jobId, input.jobId),
        sql`(${categoryAssignmentEntries.outcome} IS NULL OR (
          ${categoryAssignmentEntries.outcome} = 'failed'
          AND ${ledgerEntries.categoryId} IS NOT DISTINCT FROM ${categoryAssignmentEntries.originalCategoryId}
        ))`
      )
    )
    .orderBy(categoryAssignmentEntries.selectionOrder);
  return {
    jobId: input.jobId,
    pendingIds: rows.filter((row) => row.outcome == null).map((row) => row.ledgerEntryId),
    failedIds: rows.filter((row) => row.outcome === "failed").map((row) => row.ledgerEntryId),
  };
}
