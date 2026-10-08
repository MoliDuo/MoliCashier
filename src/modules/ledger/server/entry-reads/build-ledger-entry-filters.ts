import { createHash } from "node:crypto";
import { eq, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ValidationError } from "@/lib/errors";
import { escapedLikeContains } from "@/lib/db/like-pattern";
import { ledgerEntries } from "@/persistence";
import { convertedAmountSql } from "@/modules/currency/server/conversion-sql";
import type { LedgerEntryFilterParams } from "@/modules/ledger/filters";
import { serializeLedgerQuery } from "@/modules/ledger/ledger-query";
import { z } from "zod";
import { dateStringSchema, UUID_REGEX } from "@/lib/validation";

// PostgreSQL query construction remains private to this module.

export type { LedgerEntryFilterParams } from "@/modules/ledger/filters";

/**
 * The main currency and accounting date an amount bound converts against,
 * named by the caller from what its query already has joined.
 */
export interface LedgerEntryConversionOperands {
  mainCurrency: SQLWrapper;
  date: SQLWrapper;
}

/**
 * Entry-value filters (category, currency, amount range, search).
 *
 * These conditions reference `ledger_entries` columns and may be reused by
 * any query whose FROM item is the plain `ledger_entries` table. The
 * date-range conditions are owned by the callers that join
 * `source_documents` under the conventional `documents` alias.
 */
export function buildLedgerEntryValueConditions(
  filters: LedgerEntryFilterParams,
  conversion: LedgerEntryConversionOperands
): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];
  const convertedAmount = () =>
    convertedAmountSql({
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
      ...conversion,
    });

  if (filters.uncategorizedOnly) {
    conditions.push(isNull(ledgerEntries.categoryId));
  } else if (filters.categoryId != null && filters.categoryId !== "") {
    conditions.push(eq(ledgerEntries.categoryId, filters.categoryId));
  }

  if (filters.currency != null && filters.currency !== "") {
    conditions.push(eq(ledgerEntries.currency, filters.currency));
  }

  // An entry without a rate for its day has no converted amount and never
  // matches an amount bound.
  if (filters.minAmount !== undefined && filters.minAmount !== null) {
    conditions.push(sql`${convertedAmount()} >= ${filters.minAmount}`);
  }

  if (filters.maxAmount !== undefined && filters.maxAmount !== null) {
    conditions.push(sql`${convertedAmount()} <= ${filters.maxAmount}`);
  }

  if (filters.search != null && filters.search !== "") {
    const literalPattern = escapedLikeContains(filters.search);
    conditions.push(
      sql`lower(${ledgerEntries.itemName} || ' ' || COALESCE(${ledgerEntries.description}, ''))
        LIKE ${literalPattern}`
    );
  }

  return conditions;
}

/**
 * Accounting-date range conditions over the `document_date` column. Callers must join `source_documents` under the `documents` alias.
 */
export function buildLedgerEntryDocumentDateConditions(
  filters: LedgerEntryFilterParams
): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];
  if (filters.startDate != null && filters.startDate !== "") {
    conditions.push(sql`documents.document_date >= ${filters.startDate}::date`);
  }
  if (filters.endDate != null && filters.endDate !== "") {
    conditions.push(sql`documents.document_date <= ${filters.endDate}::date`);
  }
  return conditions;
}

function queryFingerprint(filters: LedgerEntryFilterParams): string {
  return createHash("sha256")
    .update(serializeLedgerQuery(filters))
    .digest("base64url")
    .slice(0, 16);
}

interface LedgerEntryCursor {
  documentDate: string;
  documentCreatedAt: string;
  documentId: string;
  position: number;
  entryId: string;
  fingerprint: string;
}

export function encodeLedgerEntryCursor(
  value: Omit<LedgerEntryCursor, "fingerprint">,
  filters: LedgerEntryFilterParams
): string {
  return Buffer.from(JSON.stringify({ ...value, fingerprint: queryFingerprint(filters) })).toString(
    "base64url"
  );
}

const ledgerEntryCursorSchema = z
  .object({
    documentDate: dateStringSchema,
    documentCreatedAt: z.string().datetime({ offset: true }),
    documentId: z.string().regex(UUID_REGEX),
    position: z.number().int().nonnegative(),
    entryId: z.string().regex(UUID_REGEX),
    fingerprint: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  })
  .strict();

export interface LedgerEntryCursorColumns {
  documentDate: SQL;
  documentCreatedAt: SQL;
  documentId: SQL;
  position: SQL;
  entryId: SQL;
}

// Defaults reference the `visible_entries` CTE projection used by
// listLedgerEntryPage. Callers that place the predicate inside the CTE body
// must pass the underlying qualified columns instead.
const cursorColumns = (): LedgerEntryCursorColumns => ({
  documentDate: sql`document_date`,
  documentCreatedAt: sql`document_created_at`,
  documentId: sql`document_id`,
  position: sql`position`,
  entryId: sql`id`,
});

export function buildLedgerEntryCursorCondition(
  cursor: string | null | undefined,
  filters: LedgerEntryFilterParams,
  columns: LedgerEntryCursorColumns = cursorColumns()
): SQL<unknown> | null {
  if (cursor == null || cursor === "") {
    return null;
  }
  if (cursor.length > 1024) {
    throw new ValidationError("Invalid ledger entry cursor");
  }

  let value: LedgerEntryCursor;
  try {
    value = ledgerEntryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
  } catch {
    throw new ValidationError("Invalid ledger entry cursor");
  }
  if (value.fingerprint !== queryFingerprint(filters)) {
    throw new ValidationError("Ledger entry cursor does not match the query");
  }

  // Compare in PostgreSQL rather than through a JavaScript Date: created_at
  // has microsecond precision and a Date would truncate it to milliseconds,
  // skipping or repeating rows at a page boundary. Older cursors carry
  // millisecond strings and still parse.
  const createdAt = sql`${value.documentCreatedAt}::timestamptz`;
  return sql`(
    ${columns.documentDate} < ${value.documentDate}
    OR (${columns.documentDate} = ${value.documentDate}
      AND ${columns.documentCreatedAt} < ${createdAt})
    OR (${columns.documentDate} = ${value.documentDate}
      AND ${columns.documentCreatedAt} = ${createdAt}
      AND ${columns.documentId} < ${value.documentId})
    OR (${columns.documentDate} = ${value.documentDate}
      AND ${columns.documentCreatedAt} = ${createdAt}
      AND ${columns.documentId} = ${value.documentId}
      AND ${columns.position} > ${value.position})
    OR (${columns.documentDate} = ${value.documentDate}
      AND ${columns.documentCreatedAt} = ${createdAt}
      AND ${columns.documentId} = ${value.documentId}
      AND ${columns.position} = ${value.position}
      AND ${columns.entryId} > ${value.entryId})
  )`;
}
