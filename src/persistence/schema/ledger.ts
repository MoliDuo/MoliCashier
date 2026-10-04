import {
  pgTable,
  text,
  integer,
  index,
  unique,
  uniqueIndex,
  foreignKey,
  timestamp,
  boolean,
  check,
  numeric,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { rowTimestamp } from "./columns";

/*
 * The ledger is a singleton, so no other table names it: every row belongs to
 * the one ledger, and keys between tables are plain single-column keys.
 */

// These declarations only provide physical target columns to FK builders.
// The complete table remains uniquely exported from its owning module.
const sourceDocumentsReference = pgTable("source_documents", {
  id: uuid("id").notNull(),
});

export const ledgers = pgTable(
  "ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiLanguage: text("ai_language").notNull().default("zh-CN"),
    preferredCurrencies: varchar("preferred_currencies", { length: 3 })
      .array()
      .notNull()
      .default([]),
    mainCurrency: varchar("main_currency", { length: 3 }).notNull().default("CNY"),
    collapseEntriesDefault: boolean("collapse_entries_default").notNull().default(false),
    aiCustomPrompt: text("ai_custom_prompt").notNull().default(""),
    /** What the daily maintenance learned from the owner's corrections; never the hand-written prompt. */
    aiLearnedPreferences: text("ai_learned_preferences").notNull().default(""),
    aiLearnedPreferencesUpdatedAt: timestamp("ai_learned_preferences_updated_at", {
      withTimezone: true,
    }),
    /** Off, corrections are not recorded and nothing new is learned. */
    aiPreferenceLearningEnabled: boolean("ai_preference_learning_enabled").notNull().default(true),
    /** The zone every day in the ledger is read in: "today", periods, record dates. */
    timeZone: text("time_zone").notNull().default("Asia/Shanghai"),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    check("ck_ledgers_main_currency", sql`${table.mainCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "ck_ledgers_preferred_currencies",
      sql`cardinality(${table.preferredCurrencies}) <= 32 AND (
        cardinality(${table.preferredCurrencies}) = 0 OR
        array_to_string(${table.preferredCurrencies}, ',') ~ '^([A-Z]{3})(,[A-Z]{3})*$'
      )`
    ),
    check("ck_ledgers_ai_language_length", sql`length(${table.aiLanguage}) BETWEEN 2 AND 35`),
    check("ck_ledgers_ai_custom_prompt_length", sql`length(${table.aiCustomPrompt}) <= 4000`),
    check(
      "ck_ledgers_ai_learned_preferences_length",
      sql`length(${table.aiLearnedPreferences}) <= 2000`
    ),
    check("ck_ledgers_time_zone_length", sql`length(${table.timeZone}) BETWEEN 1 AND 50`),
    // The ledger is a singleton: a second row cannot exist.
    uniqueIndex("uq_ledgers_singleton").on(sql`(true)`),
  ]
);

export type Ledger = InferSelectModel<typeof ledgers>;

/**
 * A 分账: the bucket every record belongs to. Reading all of them together is
 * 总账, which is a view over every book rather than a designated one, so no row
 * here is special. A book has no zone of its own: the ledger's zone dates every
 * book.
 */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    index("idx_books_active_sort")
      .on(table.sortOrder, table.createdAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("uq_books_active_name")
      .on(table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    check("ck_books_name_length", sql`length(btrim(${table.name})) BETWEEN 1 AND 20`),
  ]
);

export type Book = InferSelectModel<typeof books>;

export const entryCategories = pgTable(
  "entry_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    index("idx_entry_categories_sort").on(table.sortOrder, table.createdAt, table.id),
    // The database declares this DEFERRABLE INITIALLY IMMEDIATE, which Drizzle
    // cannot express: it is checked when a statement ends, so one UPDATE can
    // swap names.
    unique("uq_entry_categories_name").on(table.name),
  ]
);

export type EntryCategory = InferSelectModel<typeof entryCategories>;

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id"),
    sourceDocumentId: uuid("source_document_id").notNull(),
    position: integer("position").notNull().default(0),
    amount: numeric("amount", { precision: 21, scale: 3, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    itemName: text("item_name").notNull(),
    description: text("description"),
    /** True for an entry the AI wrote when it activated an attempt; false for one the owner added. */
    extracted: boolean("extracted").notNull().default(false),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    index("idx_ledger_entries_search").using(
      "gin",
      sql`lower(${table.itemName} || ' ' || COALESCE(${table.description}, '')) public.gin_trgm_ops`
    ),
    index("idx_ledger_entries_category").on(table.categoryId),
    index("idx_ledger_entries_document_position").on(
      table.sourceDocumentId,
      table.position,
      table.id
    ),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [entryCategories.id],
      name: "fk_ledger_entries_category",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocumentsReference.id],
      name: "fk_ledger_entries_source_document",
    }).onDelete("cascade"),
    check("ck_ledger_entries_currency", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("ck_ledger_entries_position", sql`${table.position} >= 0`),
  ]
);

export type LedgerEntry = InferSelectModel<typeof ledgerEntries>;

/** An API key. Revoking one stamps `revoked_at` and keeps the row for the record. */
export const serviceCredentials = pgTable(
  "service_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash"),
    tokenPrefix: text("token_prefix"),
    tokenSuffix: text("token_suffix"),
    bookId: uuid("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: rowTimestamp("created_at"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_service_credentials_token_hash")
      .on(table.tokenHash)
      .where(sql`${table.tokenHash} IS NOT NULL`),
    index("idx_service_credentials_book").on(table.bookId),
    foreignKey({
      columns: [table.bookId],
      foreignColumns: [books.id],
      name: "fk_service_credentials_book",
    }),
    check(
      "ck_service_credentials_active_hashed",
      sql`${table.revokedAt} IS NOT NULL OR (${table.tokenHash} IS NOT NULL AND ${table.tokenPrefix} IS NOT NULL AND ${table.tokenSuffix} IS NOT NULL)`
    ),
  ]
);

export type ServiceCredential = InferSelectModel<typeof serviceCredentials>;

/**
 * One difference between what the AI wrote and what the owner changed it to,
 * per subject (an entry or a document) and field. A later edit updates the row,
 * and changing the value back to the AI's own removes it. `consumed_at` marks
 * the corrections a learning run already read.
 */
export const aiCorrections = pgTable(
  "ai_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    /** The entry id for category and item name corrections, the document id for a title. */
    subjectId: uuid("subject_id").notNull(),
    field: text("field").$type<"category" | "item_name" | "title">().notNull(),
    documentTitle: text("document_title"),
    itemName: text("item_name"),
    amount: numeric("amount", { precision: 21, scale: 3, mode: "string" }),
    currency: varchar("currency", { length: 3 }),
    beforeValue: text("before_value").notNull(),
    afterValue: text("after_value").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("uq_ai_corrections_subject_field").on(table.subjectId, table.field),
    index("idx_ai_corrections_unconsumed")
      .on(table.updatedAt)
      .where(sql`${table.consumedAt} IS NULL`),
    index("idx_ai_corrections_source_document").on(table.sourceDocumentId),
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocumentsReference.id],
      name: "fk_ai_corrections_source_document",
    }).onDelete("cascade"),
    check("ck_ai_corrections_field", sql`${table.field} IN ('category', 'item_name', 'title')`),
  ]
);

export type AiCorrection = InferSelectModel<typeof aiCorrections>;
