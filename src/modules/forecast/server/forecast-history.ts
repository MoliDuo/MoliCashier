import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { HistoryRow } from "@/modules/forecast/domain/series";

export interface ForecastHistory {
  mainCurrency: string;
  rows: HistoryRow[];
  categories: Map<string, { name: string; icon: string | null }>;
}

/**
 * Every day's spending from `from` through `to`, per category and original
 * currency, converted to the main currency the way 统计 converts it. An entry
 * with no rate for its day has no converted amount and is left out here, as it
 * is from 统计's totals.
 */
export async function readForecastHistory(
  range: { from: string; to: string },
  bookId?: string
): Promise<ForecastHistory> {
  const [rows, categories, ledger] = await Promise.all([
    db.execute<HistoryRow & Record<string, unknown>>(sql`
      SELECT documents.document_date::text AS date, entries.category_id AS "categoryId",
        entries.currency, sum(converted.amount)::text AS amount
      FROM source_documents documents
      JOIN ledger_entries entries
        ON entries.source_document_id = documents.id
      CROSS JOIN ledgers
      CROSS JOIN LATERAL (
        SELECT convert_amount(entries.amount, entries.currency, ledgers.main_currency,
          documents.document_date) AS amount
      ) converted
      WHERE documents.document_date BETWEEN ${range.from}::date AND ${range.to}::date
        ${bookId == null ? sql`` : sql`AND documents.book_id = ${bookId}`}
        AND converted.amount IS NOT NULL
      GROUP BY documents.document_date, entries.category_id, entries.currency
      ORDER BY documents.document_date
    `),
    db.execute<{ id: string; name: string; icon: string | null }>(sql`
      SELECT id, name, icon FROM entry_categories
    `),
    db.execute<{ mainCurrency: string }>(sql`
      SELECT main_currency AS "mainCurrency" FROM ledgers LIMIT 1
    `),
  ]);
  return {
    mainCurrency: ledger.rows[0]?.mainCurrency ?? "CNY",
    rows: rows.rows.map((row) => ({
      date: row.date,
      categoryId: row.categoryId,
      currency: row.currency,
      amount: row.amount,
    })),
    categories: new Map(
      categories.rows.map((category) => [category.id, { name: category.name, icon: category.icon }])
    ),
  };
}
