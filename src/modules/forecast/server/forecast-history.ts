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
 * Every entry from `from` through `to`, converted to the main currency the
 * way 统计 converts it, with the document it is on and what that document is
 * called — its title, or its first line's name — for finding recurring bills.
 * An entry with no rate for its day has no converted amount and is left out
 * here, as it is from 统计's totals.
 */
export async function readForecastHistory(
  range: { from: string; to: string },
  bookId?: string
): Promise<ForecastHistory> {
  const [rows, categories, ledger] = await Promise.all([
    db.execute<{
      date: string;
      categoryId: string | null;
      currency: string;
      amount: string;
      documentId: string;
      label: string | null;
    }>(sql`
      SELECT documents.document_date::text AS date, entries.category_id AS "categoryId",
        entries.currency, converted.amount::text AS amount, documents.id AS "documentId",
        coalesce(nullif(btrim(documents.title), ''), first_value(entries.item_name) OVER (
          PARTITION BY documents.id ORDER BY entries.position, entries.id
        )) AS label
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
      ORDER BY documents.document_date, documents.id
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
      documentId: row.documentId,
      label: row.label,
    })),
    categories: new Map(
      categories.rows.map((category) => [category.id, { name: category.name, icon: category.icon }])
    ),
  };
}
