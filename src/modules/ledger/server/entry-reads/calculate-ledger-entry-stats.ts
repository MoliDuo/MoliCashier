import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  buildLedgerEntryDocumentDateConditions,
  buildLedgerEntryValueConditions,
} from "./build-ledger-entry-filters";
import type { LedgerEntryFilterParams } from "@/modules/ledger/filters";
import type { LedgerSummaryDto } from "@/modules/ledger/contracts";
import { normalize as decimalNormalize } from "@/lib/money/decimal";

// Single-statement aggregate implementation. The visible_entries CTE scans the
// active projection once and every aggregate branch (currency totals, trend,
// converted total, unconverted count, main currency) reads from that one scan,
// so the summary never fans out across parallel queries.

interface CalculateLedgerEntryStatsInput {
  filters: LedgerEntryFilterParams;
}

interface StatsRow {
  kind: "currency" | "trend" | "converted" | "unconverted" | "category";
  currency: string | null;
  total: string | null;
  count: number | null;
  date: string | null;
  main_currency: string | null;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
}

export async function calculateLedgerEntryStats({
  filters,
}: CalculateLedgerEntryStatsInput): Promise<LedgerSummaryDto> {
  const { currency, ...filtersWithoutCurrency } = filters;
  const conditions = [
    ...buildLedgerEntryDocumentDateConditions(filters),
    ...buildLedgerEntryValueConditions(filtersWithoutCurrency, {
      mainCurrency: sql`settings.main_currency`,
      date: sql`documents.document_date`,
    }),
    ...(currency == null || currency === "" ? [] : [sql`ledger_entries.currency = ${currency}`]),
  ];
  const whereClause =
    conditions.length === 0 ? sql`` : sql`WHERE ${sql.join(conditions, sql` AND `)}`;

  const result = await db.execute<StatsRow & Record<string, unknown>>(sql`
    WITH settings AS (
      SELECT main_currency FROM ledgers
    ),
    visible_entries AS (
      SELECT
        ledger_entries.currency,
        ledger_entries.amount,
        convert_amount(ledger_entries.amount, ledger_entries.currency,
          settings.main_currency, documents.document_date) AS converted_amount,
        documents.document_date,
        ledger_entries.category_id,
        categories.name AS category_name,
        categories.icon AS category_icon
      FROM ledger_entries
      CROSS JOIN settings
      INNER JOIN source_documents documents
        ON documents.id = ledger_entries.source_document_id
       ${filters.bookId == null ? sql`` : sql`AND documents.book_id = ${filters.bookId}`}
      LEFT JOIN entry_categories categories
        ON categories.id = ledger_entries.category_id
      ${whereClause}
    ),
    currency_totals AS (
      SELECT currency, sum(amount)::text AS total, count(*)::int AS count
      FROM visible_entries
      GROUP BY currency
    ),
    trend AS (
      SELECT document_date::text AS date, sum(converted_amount)::text AS total
      FROM visible_entries
      GROUP BY document_date
    ),
    converted_total AS (
      SELECT coalesce(sum(converted_amount), 0)::text AS total
      FROM visible_entries
    ),
    unconverted AS (
      SELECT count(*) FILTER (WHERE converted_amount IS NULL)::int AS count
      FROM visible_entries
    ),
    category_totals AS (
      SELECT category_id, category_name, category_icon, currency,
        sum(amount)::text AS total, count(*)::int AS count
      FROM visible_entries
      GROUP BY category_id, category_name, category_icon, currency
    )
    SELECT 'currency' AS kind, currency, total, count, NULL::text AS date,
      NULL::text AS main_currency, NULL::uuid AS category_id,
      NULL::text AS category_name, NULL::text AS category_icon
    FROM currency_totals
    UNION ALL
    SELECT 'trend' AS kind, NULL, total, NULL, date, NULL, NULL, NULL, NULL
    FROM trend
    UNION ALL
    SELECT 'converted' AS kind, NULL, total, NULL, NULL, main_currency, NULL, NULL, NULL
    FROM settings CROSS JOIN converted_total
    UNION ALL
    SELECT 'unconverted' AS kind, NULL, NULL, count, NULL, NULL, NULL, NULL, NULL
    FROM unconverted
    UNION ALL
    SELECT 'category' AS kind, currency, total, count, NULL, NULL,
      category_id, category_name, category_icon
    FROM category_totals
  `);

  const totals = result.rows
    .filter((row) => row.kind === "currency")
    .map((row) => ({
      currency: row.currency ?? "",
      total: decimalNormalize(String(row.total ?? "0")),
      count: Number(row.count) ?? 0,
    }));

  const trend = result.rows
    .filter((row) => row.kind === "trend")
    .filter((row) => row.date != null && row.date !== "")
    .map((row) => ({
      date: row.date ?? "",
      total: decimalNormalize(String(row.total ?? "0")),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const convertedRow = result.rows.find((row) => row.kind === "converted");
  const unconvertedRow = result.rows.find((row) => row.kind === "unconverted");
  const effectiveMainCurrency = convertedRow?.main_currency;
  const byCategory = result.rows
    .filter((row) => row.kind === "category")
    .map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryIcon: row.category_icon,
      currency: row.currency,
      total: decimalNormalize(String(row.total ?? "0")),
      count: Number(row.count ?? 0),
    }));

  return {
    unconvertedCount: Number(unconvertedRow?.count ?? 0),
    convertedTotal:
      effectiveMainCurrency == null
        ? null
        : {
            total: decimalNormalize(String(convertedRow?.total ?? "0")),
            currency: effectiveMainCurrency,
          },
    totals,
    trend,
    byCategory,
  };
}
