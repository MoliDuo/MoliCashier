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
  CategoryAssignmentMode,
} from "@/modules/ledger/contracts";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import { finishCategoryAssignmentJobIfDone } from "./lease";
import { rowMode } from "./reads";

/**
 * The commands a user gives a category assignment run: start one, pick up the
 * entries a run left in conflict, cancel it, or retry what failed.
 */

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

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += INSERT_BATCH_SIZE) {
    result.push(items.slice(offset, offset + INSERT_BATCH_SIZE));
  }
  return result;
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
