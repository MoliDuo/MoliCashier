import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
} from "@/persistence";
import type {
  CategoryAssignmentEntryResultDto,
  CategoryAssignmentEntryStatesDto,
  CategoryAssignmentJobStatus,
  CategoryAssignmentMode,
  CategoryAssignmentResultPageDto,
} from "@/modules/ledger/contracts";
import type { CategoryAssignmentCandidate } from "@/modules/ledger/domain/category-assignment-protocol";

/**
 * Reads of category assignment runs: a job with its progress, a finished run's
 * results, and the state of each entry a run still holds. Nothing here writes.
 */

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

/** A job with its progress, counted from its entry and document rows when read. */
export interface CategoryAssignmentJobRecord {
  id: string;
  status: CategoryAssignmentJobStatus;
  mode: CategoryAssignmentMode;
  candidateSnapshot: CategoryAssignmentCandidate[];
  entryCount: number;
  appliedCount: number;
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  /** Documents a worker is on right now: one while a run holds the job. */
  activeDocumentCount: number;
  /** Documents waiting out a transient failure. */
  retryingDocumentCount: number;
  nextRetryAt: string | null;
  evidenceIncomplete: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobProgressRow extends Record<string, unknown> {
  id: string;
  status: CategoryAssignmentJobStatus;
  mode: "ai" | "assign" | "clear";
  assign_category_id: string | null;
  candidate_snapshot: CategoryAssignmentCandidate[];
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  entry_count: string;
  applied: string;
  confirmed: string;
  failed: string;
  conflict: string;
  skipped: string;
  cancelled: string;
  document_total: string;
  document_completed: string;
  active: string;
  retrying: string;
  next_retry_at: Date | string | null;
  evidence_incomplete: boolean;
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapJob(row: JobProgressRow): CategoryAssignmentJobRecord {
  return {
    id: row.id,
    status: row.status,
    mode: rowMode({
      mode: row.mode,
      assignCategoryId: row.assign_category_id,
      candidateSnapshot: row.candidate_snapshot,
    }),
    candidateSnapshot: row.candidate_snapshot,
    entryCount: Number(row.entry_count),
    appliedCount: Number(row.applied),
    confirmedCount: Number(row.confirmed),
    failedCount: Number(row.failed),
    conflictCount: Number(row.conflict),
    skippedCount: Number(row.skipped),
    cancelledCount: Number(row.cancelled),
    documentTotal: Number(row.document_total),
    documentCompleted: Number(row.document_completed),
    activeDocumentCount: Number(row.active),
    retryingDocumentCount: Number(row.retrying),
    nextRetryAt: row.next_retry_at == null ? null : toIso(row.next_retry_at),
    evidenceIncomplete: row.evidence_incomplete === true,
    completedAt: row.completed_at == null ? null : toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readJob(jobId: string | null) {
  const result = await db.execute<JobProgressRow>(sql`
    SELECT job.id, job.status, job.mode, job.assign_category_id,
      job.candidate_snapshot,
      job.completed_at, job.created_at, job.updated_at,
      entries.*, documents.*,
      CASE
        WHEN job.claim_token IS NOT NULL AND job.claim_expires_at > clock_timestamp()
          AND documents.due > 0 THEN 1
        ELSE 0
      END::text AS active
    FROM ${categoryAssignmentJobs} AS job
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS entry_count,
        count(*) FILTER (WHERE outcome = 'applied')::text AS applied,
        count(*) FILTER (WHERE outcome = 'confirmed')::text AS confirmed,
        count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
        count(*) FILTER (WHERE outcome = 'conflict')::text AS conflict,
        count(*) FILTER (WHERE outcome = 'skipped')::text AS skipped,
        count(*) FILTER (WHERE outcome = 'cancelled')::text AS cancelled
      FROM ${categoryAssignmentEntries} AS entry
      WHERE entry.job_id = job.id
    ) AS entries
    CROSS JOIN LATERAL (
      SELECT
        count(*)::text AS document_total,
        count(*) FILTER (WHERE status <> 'pending')::text AS document_completed,
        count(*) FILTER (
          WHERE status = 'pending' AND next_attempt_at <= clock_timestamp()
        ) AS due,
        count(*) FILTER (
          WHERE status = 'pending' AND error_code IS NOT NULL
            AND next_attempt_at > clock_timestamp()
        )::text AS retrying,
        min(next_attempt_at) FILTER (
          WHERE status = 'pending' AND error_code IS NOT NULL
            AND next_attempt_at > clock_timestamp()
        ) AS next_retry_at,
        coalesce(bool_or(evidence_incomplete), false) AS evidence_incomplete
      FROM ${categoryAssignmentDocuments} AS work
      WHERE work.job_id = job.id
    ) AS documents
    ${jobId == null ? sql`` : sql`WHERE job.id = ${jobId}`}
    ORDER BY job.created_at DESC, job.id DESC
    LIMIT 1
  `);
  const row = result.rows[0];
  return row == null ? null : mapJob(row);
}

export async function getCategoryAssignmentJob(input: {
  jobId: string;
}): Promise<CategoryAssignmentJobRecord | null> {
  return readJob(input.jobId);
}

export async function getLatestCategoryAssignmentJob(): Promise<CategoryAssignmentJobRecord | null> {
  return readJob(null);
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
