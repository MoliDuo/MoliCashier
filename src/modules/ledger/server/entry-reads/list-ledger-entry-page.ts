import { inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { cursorTimestampSql } from "@/lib/db/cursor-timestamp";
import { AppError } from "@/lib/errors";
import { mapLedgerEntryDto } from "./mappers";
import {
  buildLedgerEntryCursorCondition,
  buildLedgerEntryDocumentDateConditions,
  buildLedgerEntryValueConditions,
  encodeLedgerEntryCursor,
  type LedgerEntryFilterParams,
} from "./build-ledger-entry-filters";
import { ledgerEntries, sourceDocumentFiles } from "@/persistence";
import {
  entryConvertedAmountSql,
  entryExchangeRateSql,
} from "@/modules/currency/server/conversion-sql";

interface ListLedgerEntryPageInput {
  limit?: number;
  cursor?: string | null;
  filters: LedgerEntryFilterParams;
}

interface VisibleEntryRow {
  id: string;
  position: number;
  documentDate: string;
  // Microsecond-precision ISO string formatted in SQL for the cursor.
  documentCreatedAt: string;
  documentId: string;
}

export async function listLedgerEntryPage({
  limit = 20,
  cursor,
  filters,
}: ListLedgerEntryPageInput) {
  return db.transaction(
    async (tx) => {
      const cursorCondition = buildLedgerEntryCursorCondition(cursor, filters, {
        documentDate: sql`documents.document_date`,
        documentCreatedAt: sql`documents.created_at`,
        documentId: sql`documents.id`,
        position: sql`ledger_entries.position`,
        entryId: sql`ledger_entries.id`,
      });
      const whereConditions = [
        ...buildLedgerEntryDocumentDateConditions(filters),
        ...buildLedgerEntryValueConditions(filters, {
          mainCurrency: sql`(SELECT main_currency FROM ledgers)`,
          date: sql`documents.document_date`,
        }),
        cursorCondition,
      ].filter((condition): condition is SQL<unknown> => condition != null);

      // Phase 1: a bounded keyset page over one scan of the entries joined to
      // their documents. The CTE applies the accounting-date range, entry
      // filters and the cursor predicate in SQL, so no ordering scalar subquery
      // is re-executed per row or per cursor branch.
      const page = await tx.execute<VisibleEntryRow & Record<string, unknown>>(sql`
    WITH visible_entries AS (
      SELECT
        ledger_entries.id,
        ledger_entries.position,
        ledger_entries.source_document_id,
        documents.document_date,
        documents.created_at AS document_created_at,
        documents.id AS document_id
      FROM ledger_entries
      INNER JOIN source_documents documents
        ON documents.id = ledger_entries.source_document_id
       ${filters.bookId == null ? sql`` : sql`AND documents.book_id = ${filters.bookId}`}
      ${whereConditions.length === 0 ? sql`` : sql`WHERE ${sql.join(whereConditions, sql` AND `)}`}
    )
    SELECT id, position, document_date::text AS "documentDate",
      ${cursorTimestampSql(sql`document_created_at`)} AS "documentCreatedAt",
      document_id AS "documentId"
    FROM visible_entries
    ORDER BY document_date DESC, document_created_at DESC, document_id DESC,
      position ASC, id ASC
    LIMIT ${limit + 1}
  `);

      const hasMore = page.rows.length > limit;
      const pagedRows = hasMore ? page.rows.slice(0, limit) : page.rows;

      let nextCursor: string | null = null;
      if (hasMore) {
        const lastItem = pagedRows.at(-1);
        if (lastItem == null) {
          throw new AppError("Expected next ledger entry page cursor row", "INVARIANT_VIOLATION");
        }
        nextCursor = encodeLedgerEntryCursor(
          {
            documentDate: lastItem.documentDate,
            documentCreatedAt: lastItem.documentCreatedAt,
            documentId: lastItem.documentId,
            position: lastItem.position,
            entryId: lastItem.id,
          },
          filters
        );
      }

      // Phase 2: bounded hydration of exactly the page rows, preserving the
      // keyset order from phase 1.
      const order = new Map(pagedRows.map((row, index) => [row.id, index]));
      const rows =
        pagedRows.length === 0
          ? []
          : await tx.query.ledgerEntries
              .findMany({
                where: inArray(
                  ledgerEntries.id,
                  pagedRows.map((row) => row.id)
                ),
                with: {
                  category: true,
                  sourceDocument: {
                    columns: {
                      id: true,
                      version: true,
                      title: true,
                      documentDate: true,
                      createdAt: true,
                      updatedAt: true,
                    },
                  },
                },
                extras: {
                  convertedAmount: entryConvertedAmountSql().as("converted_amount"),
                  exchangeRate: entryExchangeRateSql().as("exchange_rate"),
                  hasImages: sql<boolean>`EXISTS (
                    SELECT 1
                    FROM ${sourceDocumentFiles} page_document_file
                    WHERE page_document_file.source_document_id = ${ledgerEntries.sourceDocumentId}
                  )`.as("has_images"),
                },
              })
              .then((found) =>
                found.toSorted(
                  (left, right) =>
                    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                    (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)
                )
              );

      if (rows.length !== pagedRows.length) {
        throw new AppError(
          "Ledger entry page hydration did not match the snapshot page",
          "INVARIANT_VIOLATION"
        );
      }

      const items = rows.map((row) => {
        const dto = mapLedgerEntryDto({
          ...row,
          category: row.category,
          sourceDocument: row.sourceDocument,
        });

        dto.sourceDocument.hasImages = row.hasImages;

        return dto;
      });

      return {
        items,
        nextCursor,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
