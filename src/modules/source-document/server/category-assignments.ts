import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  sourceDocuments,
} from "@/persistence";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";
import { assertSourceDocumentsNotProcessing } from "@/modules/source-document/server/write-guards";
import { leaseHeldBy } from "@/lib/db/lease";
import type { CategoryAssignmentLease } from "@/server/category-assignment/lease";
import { ConflictError } from "@/lib/errors";

export interface ApplyCategoryAssignmentsInput {
  lease: CategoryAssignmentLease;
  sourceDocumentId: string;
  now?: Date;
}

export type ApplyCategoryAssignmentsResult =
  | { status: "applied"; appliedCount: number; confirmedCount: number; conflictCount: number }
  | { status: "conflict" | "skipped" | "claim_lost" };

/**
 * Writes one document's decided categories and every entry's outcome. Locks
 * the ledger, then the document, then the job row, whose lease must still be
 * the caller's: a cancel or a newer worker makes this a no-op.
 */
export async function applyCategoryAssignments(
  input: ApplyCategoryAssignmentsInput
): Promise<ApplyCategoryAssignmentsResult> {
  const now = input.now ?? new Date();
  const { jobId, claimToken } = input.lease;
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const document = await tx
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, input.sourceDocumentId))
      .for("update")
      .then((rows) => rows[0]);
    const job = await tx
      .select({ id: categoryAssignmentJobs.id })
      .from(categoryAssignmentJobs)
      .where(
        and(
          eq(categoryAssignmentJobs.id, jobId),
          leaseHeldBy(
            categoryAssignmentJobs.claimToken,
            categoryAssignmentJobs.claimExpiresAt,
            claimToken
          )
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (job == null) return { status: "claim_lost" };
    // Deleting the document took its work and entry rows with it, so there is
    // no outcome left to record.
    if (document == null) return { status: "skipped" };
    const work = await tx
      .select({ status: categoryAssignmentDocuments.status })
      .from(categoryAssignmentDocuments)
      .where(
        and(
          eq(categoryAssignmentDocuments.jobId, jobId),
          eq(categoryAssignmentDocuments.sourceDocumentId, input.sourceDocumentId)
        )
      )
      .then((rows) => rows[0]);
    if (work?.status !== "pending") return { status: "claim_lost" };

    const finishWithoutWrite = async (status: "conflict" | "skipped", errorCode: string) => {
      await tx
        .update(categoryAssignmentEntries)
        .set({ outcome: status, errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryAssignmentEntries.jobId, jobId),
            eq(categoryAssignmentEntries.sourceDocumentId, input.sourceDocumentId),
            isNull(categoryAssignmentEntries.outcome)
          )
        );
      await tx
        .update(categoryAssignmentDocuments)
        .set({ status, errorCode, updatedAt: now })
        .where(
          and(
            eq(categoryAssignmentDocuments.jobId, jobId),
            eq(categoryAssignmentDocuments.sourceDocumentId, input.sourceDocumentId)
          )
        );
      return { status } as const;
    };

    try {
      await assertSourceDocumentsNotProcessing(tx, [document]);
    } catch (error) {
      if (error instanceof ConflictError) {
        return finishWithoutWrite("conflict", "document_changed");
      }
      throw error;
    }

    const selected = await tx
      .select({
        work: categoryAssignmentEntries,
        currentCategoryId: ledgerEntries.categoryId,
        sourceDocumentId: ledgerEntries.sourceDocumentId,
      })
      .from(categoryAssignmentEntries)
      .leftJoin(ledgerEntries, eq(ledgerEntries.id, categoryAssignmentEntries.ledgerEntryId))
      .where(
        and(
          eq(categoryAssignmentEntries.jobId, jobId),
          eq(categoryAssignmentEntries.sourceDocumentId, input.sourceDocumentId)
        )
      )
      .orderBy(categoryAssignmentEntries.selectionOrder);
    // A reparse replaces the entries and a split moves them to another
    // document; either way the selection no longer describes this one. An
    // entry that is gone joins as null and so fails the document check.
    if (
      selected.some(
        (entry) =>
          entry.sourceDocumentId !== input.sourceDocumentId || !entry.work.decisionPersisted
      )
    ) {
      return finishWithoutWrite("skipped", "document_unavailable");
    }
    const categoryIds = [
      ...new Set(selected.map((entry) => entry.work.targetCategoryId).filter(Boolean)),
    ] as string[];
    if (categoryIds.length > 0) {
      const available = await tx
        .select({ id: entryCategories.id })
        .from(entryCategories)
        .where(inArray(entryCategories.id, categoryIds));
      if (available.length !== categoryIds.length) {
        return finishWithoutWrite("conflict", "category_changed");
      }
    }

    // Each entry is written only if it still has the category it had when it
    // was selected; one changed since then is a conflict on its own, and the
    // document's other entries still apply.
    const changing = selected.filter(
      (entry) => entry.currentCategoryId !== entry.work.targetCategoryId
    );
    const written =
      changing.length === 0
        ? []
        : await tx
            .execute<{ id: string }>(
              sql`
            UPDATE ledger_entries AS entry
            SET category_id = target.category_id, updated_at = ${now}
            FROM (VALUES ${sql.join(
              changing.map(
                (item) =>
                  sql`(${item.work.ledgerEntryId}::uuid, ${item.work.targetCategoryId}::uuid, ${item.work.originalCategoryId}::uuid)`
              ),
              sql`, `
            )}) AS target(id, category_id, original_category_id)
            WHERE entry.id = target.id
              AND entry.source_document_id = ${input.sourceDocumentId}
              AND entry.category_id IS NOT DISTINCT FROM target.original_category_id
            RETURNING entry.id
          `
            )
            .then((result) => result.rows);
    const applied = new Set(written.map((row) => row.id));
    const outcomes = selected.map((entry) => ({
      ledgerEntryId: entry.work.ledgerEntryId,
      outcome:
        entry.currentCategoryId === entry.work.targetCategoryId
          ? ("confirmed" as const)
          : applied.has(entry.work.ledgerEntryId)
            ? ("applied" as const)
            : ("conflict" as const),
    }));
    if (outcomes.length > 0) {
      await tx.execute(sql`
        UPDATE ${categoryAssignmentEntries} AS work
        SET outcome = result.outcome::category_assignment_entry_outcome,
            error_code = CASE WHEN result.outcome = 'conflict' THEN 'entry_changed' END,
            updated_at = ${now}
        FROM (VALUES ${sql.join(
          outcomes.map((item) => sql`(${item.ledgerEntryId}::uuid, ${item.outcome}::text)`),
          sql`, `
        )}) AS result(ledger_entry_id, outcome)
        WHERE work.job_id = ${jobId} AND work.ledger_entry_id = result.ledger_entry_id
      `);
    }
    const count = (outcome: string) => outcomes.filter((item) => item.outcome === outcome).length;
    const appliedCount = count("applied");
    const confirmedCount = count("confirmed");
    const conflictCount = count("conflict");
    await tx
      .update(categoryAssignmentDocuments)
      .set({ status: "succeeded", errorCode: null, updatedAt: now })
      .where(
        and(
          eq(categoryAssignmentDocuments.jobId, jobId),
          eq(categoryAssignmentDocuments.sourceDocumentId, input.sourceDocumentId)
        )
      );
    return { status: "applied", appliedCount, confirmedCount, conflictCount };
  });
}
