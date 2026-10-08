import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { rowTimestamp } from "./columns";
import { sourceDocuments } from "./source-document";

export const categoryAssignmentJobStatusEnum = pgEnum("category_assignment_job_status", [
  "pending",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
export const categoryAssignmentEntryOutcomeEnum = pgEnum("category_assignment_entry_outcome", [
  "applied",
  "confirmed",
  "failed",
  "conflict",
  "skipped",
  "cancelled",
]);
export const categoryAssignmentDocumentStatusEnum = pgEnum("category_assignment_document_status", [
  "pending",
  "succeeded",
  "failed",
  "conflict",
  "skipped",
  "cancelled",
]);

/**
 * One category assignment run. The documents it works through and the
 * outcome of each selected entry live in the two tables below; progress is
 * counted from them when the job is read.
 */
export const categoryAssignmentJobs = pgTable(
  "category_assignment_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: categoryAssignmentJobStatusEnum("status").notNull().default("pending"),
    mode: text("mode").$type<"ai" | "assign" | "clear">().notNull().default("ai"),
    /** The category an `assign` run sets on every selected entry. */
    assignCategoryId: uuid("assign_category_id"),
    /** The categories an `ai` run may choose from, as they were when it started. */
    candidateSnapshot: jsonb("candidate_snapshot")
      .$type<Array<{ id: string; name: string; description: string | null }>>()
      .notNull()
      .default([]),
    customPromptSnapshot: text("custom_prompt_snapshot"),
    /** The learned preferences as they were when the run started, like the prompt snapshot. */
    learnedPreferencesSnapshot: text("learned_preferences_snapshot"),
    requestKey: uuid("request_key"),
    /** The run whose failures this run retries. */
    retryOfJobId: uuid("retry_of_job_id"),
    // One worker runs a job at a time; its lease fences every write the run
    // makes, from a document's decisions to the job's final status.
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.retryOfJobId],
      foreignColumns: [table.id],
      name: "fk_category_assignment_jobs_retry_of_job",
    }).onDelete("set null"),
    // Deleting a run sets its retries' link to null; this finds them.
    index("idx_category_assignment_jobs_retry_of_job").on(table.retryOfJobId),
    uniqueIndex("uq_category_assignment_jobs_request_key").on(table.requestKey),
    // One run at a time: a double submit becomes a conflict instead of paying
    // for the same model calls twice.
    uniqueIndex("uq_category_assignment_jobs_active")
      .on(sql`(true)`)
      .where(sql`${table.status} IN ('pending', 'running')`),
    check("ck_category_assignment_jobs_mode", sql`${table.mode} IN ('ai', 'assign', 'clear')`),
  ]
);

export const categoryAssignmentDocuments = pgTable(
  "category_assignment_documents",
  {
    jobId: uuid("job_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    /** The position of the document's first selected entry in the selection. */
    selectionOrder: integer("selection_order").notNull(),
    status: categoryAssignmentDocumentStatusEnum("status").notNull().default("pending"),
    completedChunkCount: integer("completed_chunk_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: rowTimestamp("next_attempt_at"),
    errorCode: text("error_code"),
    evidenceIncomplete: boolean("evidence_incomplete").notNull().default(false),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    primaryKey({
      name: "category_assignment_documents_pkey",
      columns: [table.jobId, table.sourceDocumentId],
    }),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryAssignmentJobs.id],
      name: "fk_category_assignment_documents_job",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocuments.id],
      name: "fk_category_assignment_documents_source_document",
    }).onDelete("cascade"),
    index("idx_category_assignment_documents_source_document").on(table.sourceDocumentId),
  ]
);

export const categoryAssignmentEntries = pgTable(
  "category_assignment_entries",
  {
    jobId: uuid("job_id").notNull(),
    ledgerEntryId: uuid("ledger_entry_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    selectionOrder: integer("selection_order").notNull(),
    originalCategoryId: uuid("original_category_id"),
    targetCategoryId: uuid("target_category_id"),
    decisionPersisted: boolean("decision_persisted").notNull().default(false),
    outcome: categoryAssignmentEntryOutcomeEnum("outcome"),
    errorCode: text("error_code"),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    primaryKey({
      name: "category_assignment_entries_pkey",
      columns: [table.jobId, table.ledgerEntryId],
    }),
    uniqueIndex("uq_category_assignment_entries_selection_order").on(
      table.jobId,
      table.selectionOrder
    ),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryAssignmentJobs.id],
      name: "fk_category_assignment_entries_job",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.jobId, table.sourceDocumentId],
      foreignColumns: [
        categoryAssignmentDocuments.jobId,
        categoryAssignmentDocuments.sourceDocumentId,
      ],
      name: "fk_category_assignment_entries_document",
    }).onDelete("cascade"),
  ]
);
