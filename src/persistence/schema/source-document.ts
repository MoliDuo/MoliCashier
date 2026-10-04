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
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { books } from "./ledger";
import { rowTimestamp } from "./columns";

// These declarations only provide physical target columns to FK builders.
// The complete table remains uniquely exported from its owning module.
const extractionAttemptsReference = pgTable("extraction_attempts", {
  id: uuid("id").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(),
});

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
      import("@/lib/ai/date-organization").DateOrganizationSuggestion
    >(),
    /** Entries the parse found already recorded elsewhere, until the owner confirms or dismisses. */
    duplicateSuggestion:
      jsonb("duplicate_suggestion").$type<
        import("@/lib/ai/duplicate-suggestion").DuplicateSuggestion
      >(),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    index("idx_source_documents_latest_attempt").on(table.latestAttemptId),
    foreignKey({
      columns: [table.bookId],
      foreignColumns: [books.id],
      name: "fk_source_documents_book",
    }),
    // The latest attempt must be one of this document's own attempts.
    foreignKey({
      columns: [table.id, table.latestAttemptId],
      foreignColumns: [
        extractionAttemptsReference.sourceDocumentId,
        extractionAttemptsReference.id,
      ],
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
