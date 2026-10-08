import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { escapedLikeContains } from "@/lib/db/like-pattern";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { normalize as decimalNormalize } from "@/lib/money/decimal";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { convertedAmountSql } from "@/modules/currency/server/conversion-sql";

// Amount filters and totals convert in the ledger's main currency on the
// document's day; an entry without a rate matches no amount bound.
const documentMainCurrency = sql`(SELECT main_currency FROM ledgers)`;

export interface TargetSourceDocumentFilterInput {
  bookId?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  search?: string;
  /** Records holding an entry in this category. */
  categoryId?: string;
  /** Records holding an entry with no category; wins over `categoryId`. */
  uncategorizedOnly?: boolean;
  /** Records holding an entry in this currency. */
  currency?: string;
}

/**
 * Whether any entry-level filter is set. They all apply to one and the same
 * entry of a record, the way the entry view reads them, so a record matches
 * when one of its entries matches all of them together.
 */
function hasEntryFilters(input: TargetSourceDocumentFilterInput): boolean {
  return (
    input.minAmount !== undefined ||
    input.maxAmount !== undefined ||
    (input.search != null && input.search !== "") ||
    input.uncategorizedOnly === true ||
    (input.categoryId != null && input.categoryId !== "") ||
    (input.currency != null && input.currency !== "")
  );
}

export interface TargetSourceDocumentListInput extends TargetSourceDocumentFilterInput {
  cursor?: string | null;
  limit: number;
}

export function baseConditions(input: TargetSourceDocumentFilterInput): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];
  if (input.bookId != null) conditions.push(eq(sourceDocuments.bookId, input.bookId));
  if (input.statuses != null && input.statuses.length > 0) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${extractionAttempts}
        WHERE ${extractionAttempts.id} = ${sourceDocuments.latestAttemptId}
          AND ${inArray(extractionAttempts.status, input.statuses)}
      )`
    );
  }
  if (input.startDate != null && input.startDate !== "") {
    conditions.push(sql`${sourceDocuments.documentDate} >= ${input.startDate}::date`);
  }
  if (input.endDate != null && input.endDate !== "") {
    conditions.push(sql`${sourceDocuments.documentDate} <= ${input.endDate}::date`);
  }
  const searchPattern =
    input.search != null && input.search !== "" ? escapedLikeContains(input.search) : null;
  if (hasEntryFilters(input)) {
    const matchedConverted = convertedAmountSql({
      amount: sql`matched_entries.amount`,
      currency: sql`matched_entries.currency`,
      mainCurrency: documentMainCurrency,
      date: sourceDocuments.documentDate,
    });
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ledger_entries AS matched_entries
      WHERE matched_entries.source_document_id = ${sourceDocuments.id}
        ${input.minAmount !== undefined ? sql`AND ${matchedConverted} >= ${input.minAmount}` : sql``}
        ${input.maxAmount !== undefined ? sql`AND ${matchedConverted} <= ${input.maxAmount}` : sql``}
        ${
          searchPattern != null
            ? sql`AND lower(matched_entries.item_name || ' ' || COALESCE(matched_entries.description, ''))
          LIKE ${searchPattern}`
            : sql``
        }
        ${
          input.uncategorizedOnly === true
            ? sql`AND matched_entries.category_id IS NULL`
            : input.categoryId != null && input.categoryId !== ""
              ? sql`AND matched_entries.category_id = ${input.categoryId}`
              : sql``
        }
        ${
          input.currency != null && input.currency !== ""
            ? sql`AND matched_entries.currency = ${input.currency}`
            : sql``
        }
    )`);
  }
  return conditions;
}

/** Sum active projections across the full filtered Stream result. */
export async function calculateCompletedSourceDocumentTotal(
  input: TargetSourceDocumentFilterInput
): Promise<{ total: string; unconvertedCount: number }> {
  const converted = convertedAmountSql({
    amount: ledgerEntries.amount,
    currency: ledgerEntries.currency,
    mainCurrency: documentMainCurrency,
    date: sourceDocuments.documentDate,
  });
  const matchedEntryConditions: SQL<unknown>[] = [];
  if (input.minAmount !== undefined) {
    matchedEntryConditions.push(sql`${converted} >= ${input.minAmount}`);
  }
  if (input.maxAmount !== undefined) {
    matchedEntryConditions.push(sql`${converted} <= ${input.maxAmount}`);
  }
  if (input.search != null && input.search !== "") {
    const searchPattern = escapedLikeContains(input.search);
    matchedEntryConditions.push(
      sql`lower(${ledgerEntries.itemName} || ' ' || COALESCE(${ledgerEntries.description}, ''))
        LIKE ${searchPattern}`
    );
  }
  if (input.uncategorizedOnly === true) {
    matchedEntryConditions.push(isNull(ledgerEntries.categoryId));
  } else if (input.categoryId != null && input.categoryId !== "") {
    matchedEntryConditions.push(eq(ledgerEntries.categoryId, input.categoryId));
  }
  if (input.currency != null && input.currency !== "") {
    matchedEntryConditions.push(eq(ledgerEntries.currency, input.currency));
  }
  const result = await db
    .select({
      total: sql<string>`SUM(${converted})`,
      unconvertedCount: sql<number>`COUNT(*) FILTER (WHERE ${converted} IS NULL)`,
    })
    .from(sourceDocuments)
    .innerJoin(
      ledgerEntries,
      and(eq(ledgerEntries.sourceDocumentId, sourceDocuments.id), ...matchedEntryConditions)
    )
    .where(and(...baseConditions(input)))
    .then((rows) => rows[0]);

  return {
    total: decimalNormalize(String(result?.total ?? "0")),
    unconvertedCount: Number(result?.unconvertedCount ?? 0),
  };
}
