import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { rowTimestamp } from "./columns";

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    checksum: text("checksum"),
    createdAt: rowTimestamp("created_at"),
    /**
     * When a document last took or let go of the file, kept by a trigger on
     * `source_document_files`. Null until that first happens; the daily cleanup
     * counts a file's unused week from it, or from `created_at` when null.
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_stored_files_storage_key").on(table.storageKey),
    check("ck_stored_files_byte_size", sql`${table.byteSize} >= 0`),
  ]
);
