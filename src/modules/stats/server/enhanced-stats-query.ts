import "server-only";
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { GetEnhancedStatsInput } from "@/modules/stats/contract-schemas";
import {
  buildEnhancedStatsDto,
  type EnhancedStatsBucket,
} from "@/modules/stats/domain/build-enhanced-stats";
import type { EnhancedStatsDto, StatsLargestEntryDto } from "@/modules/stats/contracts";

interface AggregatedRow {
  period: "current" | "previous";
  documentDate: string | null;
  currency: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  totalAmount: string | null;
  entryCount: number;
  mainCurrency: string;
  unconvertedCount: number;
}

/** The first day any record in the scope is dated, so 全部 knows where to start. */
export async function findEarliestDocumentDate(bookId?: string): Promise<string | null> {
  const result = await db.execute<{ earliest: string | null }>(sql`
    SELECT min(document_date)::text AS earliest FROM source_documents
    ${bookId == null ? sql`` : sql`WHERE book_id = ${bookId}`}
  `);
  return result.rows[0]?.earliest ?? null;
}

async function fetchAggregatedRows(
  current: { from: string; to: string },
  previous: { from: string; to: string },
  bookId?: string
): Promise<AggregatedRow[]> {
  const result = await db.execute<AggregatedRow & Record<string, unknown>>(sql`
    WITH ranges(period, from_date, to_date) AS (
      VALUES
        ('current'::text, ${current.from}::date, ${current.to}::date),
        ('previous'::text, ${previous.from}::date, ${previous.to}::date)
    )
    SELECT ranges.period, documents.document_date::text AS "documentDate",
      entries.currency, entries.category_id AS "categoryId",
      categories.name AS "categoryName", categories.icon AS "categoryIcon",
      sum(converted.amount)::text AS "totalAmount",
      count(*) FILTER (WHERE converted.amount IS NOT NULL)::int AS "entryCount",
      ledgers.main_currency AS "mainCurrency",
      count(*) FILTER (WHERE converted.amount IS NULL)::int AS "unconvertedCount"
    FROM ranges
    JOIN source_documents documents
      ON documents.document_date BETWEEN ranges.from_date AND ranges.to_date
      ${bookId == null ? sql`` : sql`AND documents.book_id = ${bookId}`}
    JOIN ledger_entries entries
      ON entries.source_document_id = documents.id
    CROSS JOIN ledgers
    CROSS JOIN LATERAL (
      SELECT convert_amount(entries.amount, entries.currency, ledgers.main_currency,
        documents.document_date) AS amount
    ) converted
    LEFT JOIN entry_categories categories
      ON categories.id = entries.category_id
    GROUP BY ranges.period, documents.document_date, entries.currency, entries.category_id,
      categories.name, categories.icon, ledgers.main_currency
    UNION ALL
    SELECT 'current', NULL, NULL, NULL, NULL, NULL, NULL, 0, main_currency, 0
    FROM ledgers
  `);
  return result.rows.map((row) => ({
    ...row,
    entryCount: Number(row.entryCount),
    unconvertedCount: Number(row.unconvertedCount),
  }));
}

function emptyBucket(): EnhancedStatsBucket {
  return {
    total: new Decimal(0),
    categories: new Map(),
    days: new Map(),
  };
}

function addRowToBucket(
  bucket: EnhancedStatsBucket,
  row: AggregatedRow,
  mainCurrency: string
): void {
  if (row.entryCount === 0 || row.totalAmount == null) return;
  const converted = new Decimal(row.totalAmount);
  bucket.total = bucket.total.plus(converted);

  const categoryKey = row.categoryId ?? "uncategorized";
  const category = bucket.categories.get(categoryKey) ?? {
    id: row.categoryId,
    name: row.categoryName,
    icon: row.categoryIcon ?? null,
    total: new Decimal(0),
    count: 0,
  };
  category.total = category.total.plus(converted);
  category.count += row.entryCount;
  bucket.categories.set(categoryKey, category);

  const date = row.documentDate ?? "";
  if (date !== "") {
    const day = bucket.days.get(date) ?? {
      total: new Decimal(0),
      count: 0,
      currencies: new Set<string>(),
    };
    day.total = day.total.plus(converted);
    day.count += row.entryCount;
    day.currencies.add(row.currency ?? mainCurrency);
    bucket.days.set(date, day);
  }
}

/** How many of the period's entries 统计 lists by size. */
const LARGEST_ENTRY_COUNT = 5;

interface LargestEntryRow {
  id: string;
  sourceDocumentId: string;
  name: string;
  categoryName: string | null;
  categoryIcon: string | null;
  date: string;
  amount: string;
  originalAmount: string;
  originalCurrency: string;
}

/**
 * The period's biggest entries once converted. An entry with no rate for its
 * day has no converted size to rank by, so it is left out here as it is from
 * the totals; a refund is not spending and is left out too.
 */
async function fetchLargestEntries(
  range: { from: string; to: string },
  bookId?: string
): Promise<StatsLargestEntryDto[]> {
  const result = await db.execute<LargestEntryRow & Record<string, unknown>>(sql`
    SELECT entries.id, documents.id AS "sourceDocumentId", entries.item_name AS name,
      categories.name AS "categoryName", categories.icon AS "categoryIcon",
      documents.document_date::text AS date, converted.amount::text AS amount,
      entries.amount::text AS "originalAmount", entries.currency AS "originalCurrency"
    FROM source_documents documents
    JOIN ledger_entries entries
      ON entries.source_document_id = documents.id
    CROSS JOIN ledgers
    CROSS JOIN LATERAL (
      SELECT convert_amount(entries.amount, entries.currency, ledgers.main_currency,
        documents.document_date) AS amount
    ) converted
    LEFT JOIN entry_categories categories
      ON categories.id = entries.category_id
    WHERE documents.document_date BETWEEN ${range.from}::date AND ${range.to}::date
      ${bookId == null ? sql`` : sql`AND documents.book_id = ${bookId}`}
      AND converted.amount > 0
    ORDER BY converted.amount DESC, documents.document_date DESC, entries.id
    LIMIT ${LARGEST_ENTRY_COUNT}
  `);
  return result.rows.map((row) => ({
    id: row.id,
    sourceDocumentId: row.sourceDocumentId,
    name: row.name,
    categoryName: row.categoryName,
    categoryIcon: row.categoryIcon,
    date: row.date,
    // Written the way every other amount in the payload is, without the
    // column's trailing zeros.
    amount: new Decimal(row.amount).toFixed(),
    originalAmount: new Decimal(row.originalAmount).toFixed(),
    originalCurrency: row.originalCurrency,
  }));
}

export async function queryEnhancedStats({
  queryRange,
  compareRange,
  comparisonMode,
  bookId,
  periodEnd,
  previousWholeTo,
}: GetEnhancedStatsInput): Promise<EnhancedStatsDto> {
  const wholeTo = previousWholeTo ?? compareRange.to;
  const [rows, largestEntries] = await Promise.all([
    fetchAggregatedRows(queryRange, { from: compareRange.from, to: wholeTo }, bookId),
    fetchLargestEntries(queryRange, bookId),
  ]);
  const mainCurrency = rows[0]?.mainCurrency ?? "CNY";
  const current = emptyBucket();
  // The previous period is read to its own end for the chart, and set against
  // the current one only up to the day the comparison is cut at.
  const previous = emptyBucket();
  const previousWhole = emptyBucket();
  let unconvertedCount = 0;
  for (const row of rows) {
    if (row.period === "current") {
      unconvertedCount += row.unconvertedCount;
      addRowToBucket(current, row, mainCurrency);
    } else {
      addRowToBucket(previousWhole, row, mainCurrency);
      if (row.documentDate != null && row.documentDate <= compareRange.to) {
        addRowToBucket(previous, row, mainCurrency);
      }
    }
  }
  if (unconvertedCount > 0) {
    logger.warn(
      { unconvertedCount, operation: "enhanced_stats" },
      "Entries missing exchange rates were excluded from main-currency statistics"
    );
  }
  return buildEnhancedStatsDto({
    mainCurrency,
    unconvertedCount,
    current,
    previous,
    previousWhole,
    queryRange,
    compareRange,
    comparisonMode,
    periodEnd,
    previousWholeTo: wholeTo,
    largestEntries,
  });
}
