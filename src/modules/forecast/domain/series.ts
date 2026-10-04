import { civilDaysBetween } from "@/modules/ledger/domain/period";

/** The key the series files entries without a category under; 统计's drilldown uses the same one. */
export const UNCATEGORIZED_KEY = "__uncategorized__";

/** One day's spending in one category and one original currency, converted to the main currency. */
export interface HistoryRow {
  date: string;
  categoryId: string | null;
  currency: string;
  /** The converted sum, as the decimal string the database returns. */
  amount: string;
}

/** Spending per category per day, the days running from `start` for `length` days. */
export interface DailySeries {
  start: string;
  length: number;
  byCategory: Map<string, Float64Array>;
}

export function categoryKeyOf(categoryId: string | null): string {
  return categoryId ?? UNCATEGORIZED_KEY;
}

/** The day of the week of a civil date, Sunday 0. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/**
 * Lays the rows out as one row of days per category, `start` through `end`.
 * Rows outside those days are left out; a day with nothing recorded is zero.
 */
export function buildDailySeries(
  rows: readonly HistoryRow[],
  start: string,
  end: string
): DailySeries {
  const length = Math.max(0, civilDaysBetween(start, end) + 1);
  const byCategory = new Map<string, Float64Array>();
  for (const row of rows) {
    const day = civilDaysBetween(start, row.date);
    if (day < 0 || day >= length) continue;
    const key = categoryKeyOf(row.categoryId);
    let values = byCategory.get(key);
    if (values == null) {
      values = new Float64Array(length);
      byCategory.set(key, values);
    }
    values[day] = values[day]! + Number(row.amount);
  }
  return { start, length, byCategory };
}
