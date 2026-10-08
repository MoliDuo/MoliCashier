import {
  check,
  pgTable,
  text,
  index,
  uniqueIndex,
  uuid,
  date,
  integer,
  jsonb,
  foreignKey,
  pgEnum,
  timestamp,
  type PgTableExtraConfigValue,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { books } from "./ledger";
import { storedFiles } from "./stored-files";
import { rowTimestamp } from "./columns";

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull(),
    /** The title, whether typed or taken from the latest completed extraction. */
    title: text("title"),
    /** The text of the current attempt's input; its files are in `source_document_files`. */
    inputText: text("input_text"),
    /** The day the record counts on, in the ledger's zone. */
    documentDate: date("document_date", { mode: "string" }).notNull(),
    /** The newest extraction attempt; null for a record split off or reorganized from another. */
    latestAttemptId: uuid("latest_attempt_id"),
    version: integer("version").notNull().default(1),
    /** Who sent the create request that made the document: `user:<id>` or `credential:<id>`. */
    idempotencySource: text("idempotency_source"),
    /** The request's idempotency key; a repeat within the ledger replays this document. */
    idempotencyKey: text("idempotency_key"),
    /** The created content, so a repeat with other content is refused. */
    idempotencyFingerprint: text("idempotency_fingerprint"),
    dateOrganizationSuggestion: jsonb("date_organization_suggestion").$type<
      import("@/lib/source-document/suggestions").DateOrganizationSuggestion
    >(),
    /** Entries the parse found already recorded elsewhere, until the owner confirms or dismisses. */
    duplicateSuggestion:
      jsonb("duplicate_suggestion").$type<
        import("@/lib/source-document/suggestions").DuplicateSuggestion
      >(),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  // Annotated: the latest-attempt key names extractionAttempts, which names this table back.
  (table): PgTableExtraConfigValue[] => [
    index("idx_source_documents_latest_attempt").on(table.latestAttemptId),
    foreignKey({
      columns: [table.bookId],
      foreignColumns: [books.id],
      name: "fk_source_documents_book",
    }),
    // The latest attempt must be one of this document's own attempts.
    foreignKey({
      columns: [table.id, table.latestAttemptId],
      foreignColumns: [extractionAttempts.sourceDocumentId, extractionAttempts.id],
      name: "fk_source_documents_latest_attempt",
    }),
    index("idx_source_documents_feed").on(
      table.documentDate.desc(),
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_source_documents_book_feed").on(
      table.bookId,
      table.documentDate.desc(),
      table.createdAt.desc(),
      table.id.desc()
    ),
    // The parse's recent-entries lookup walks documents by creation time.
    index("idx_source_documents_created").on(table.createdAt.desc(), table.id.desc()),
    uniqueIndex("uq_source_documents_idempotency").on(
      table.idempotencySource,
      table.idempotencyKey
    ),
    check("ck_source_documents_version", sql`${table.version} > 0`),
    check(
      "ck_source_documents_duplicate_suggestion",
      sql`${table.duplicateSuggestion} IS NULL OR jsonb_typeof(${table.duplicateSuggestion}) = 'object'`
    ),
    check(
      "ck_source_documents_idempotency",
      sql`(${table.idempotencySource} IS NULL) = (${table.idempotencyKey} IS NULL)`
    ),
  ]
);

export type SourceDocument = InferSelectModel<typeof sourceDocuments>;

export const extractionAttemptStatusEnum = pgEnum("extraction_attempt_status", [
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const extractionFailureKindEnum = pgEnum("extraction_failure_kind", [
  "invalid_input",
  "processing_error",
]);

/**
 * One extraction of a document's input. An attempt is its own queue entry: a
 * worker leases it through the claim columns, and a transient failure hands it
 * back due again at `next_attempt_at`.
 */
export const extractionAttempts = pgTable(
  "extraction_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    /** The document date the submission asked for, if any. */
    requestedDate: date("requested_date", { mode: "string" }),
    /** The day relative dates in the input are resolved against. */
    referenceDate: date("reference_date", { mode: "string" }),
    status: extractionAttemptStatusEnum("status").notNull(),
    failureKind: extractionFailureKindEnum("failure_kind"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    submittedAt: rowTimestamp("submitted_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocuments.id],
      name: "fk_extraction_attempts_source_document",
    }).onDelete("cascade"),
    index("idx_extraction_attempts_due")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'processing'`),
    // The target of the latest-attempt key on source_documents.
    uniqueIndex("uq_extraction_attempts_document_id").on(table.sourceDocumentId, table.id),
    uniqueIndex("uq_extraction_attempts_one_processing")
      .on(table.sourceDocumentId)
      .where(sql`${table.status} = 'processing'`),
  ]
);

/** The files of a source document's current input, in upload order. */
export const sourceDocumentFiles = pgTable(
  "source_document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    storedFileId: uuid("stored_file_id").notNull(),
    position: integer("position").notNull(),
    createdAt: rowTimestamp("created_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocuments.id],
      name: "fk_source_document_files_source_document",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.storedFileId],
      foreignColumns: [storedFiles.id],
      name: "fk_source_document_files_stored_file",
    }),
    index("idx_source_document_files_stored_file").on(table.storedFileId),
    uniqueIndex("uq_source_document_files_document_position").on(
      table.sourceDocumentId,
      table.position
    ),
    uniqueIndex("uq_source_document_files_document_file").on(
      table.sourceDocumentId,
      table.storedFileId
    ),
    check("ck_source_document_files_position", sql`${table.position} >= 0`),
  ]
);
