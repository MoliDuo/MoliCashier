import { categoryKeyOf, type HistoryRow } from "../series";
import { quantile } from "../simulate";
import type { Judgment } from "./schema";

interface CategoryDays {
  p99: number;
  largest: number;
}

/** Every category's days with spending before `today`: the 99th percentile and the largest. */
function categoryDays(rows: readonly HistoryRow[], today: string): Map<string, CategoryDays> {
  const totals = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.date >= today) continue;
    const key = categoryKeyOf(row.categoryId);
    let days = totals.get(key);
    if (days == null) {
      days = new Map();
      totals.set(key, days);
    }
    days.set(row.date, (days.get(row.date) ?? 0) + Number(row.amount));
  }
  const result = new Map<string, CategoryDays>();
  for (const [key, days] of totals) {
    const spent = Float64Array.from([...days.values()].filter((total) => total > 0)).sort();
    if (spent.length === 0) continue;
    result.set(key, { p99: quantile(spent, 0.99), largest: spent[spent.length - 1]! });
  }
  return result;
}

/**
 * The judgment with its amounts held to what the history has seen: a
 * category's everyday levels to `multiple` times the 99th percentile of its
 * past days with spending, and each expected purchase to `multiple` times the
 * category's largest past day. The AI judges, and the code sums; an answer
 * that read a month as a day would otherwise multiply the forecast thirty
 * times over. A category with no past spending has nothing to hold it to and
 * is left as judged.
 */
export function boundJudgment(
  judgment: Judgment,
  rows: readonly HistoryRow[],
  today: string,
  multiple: number
): Judgment {
  const days = categoryDays(rows, today);
  return {
    ...judgment,
    categories: judgment.categories.map((category) => {
      const seen = days.get(category.key);
      if (seen == null) return category;
      const cap = seen.p99 * multiple;
      return {
        ...category,
        low: Math.min(category.low, cap),
        mid: Math.min(category.mid, cap),
        high: Math.min(category.high, cap),
      };
    }),
    expected: judgment.expected.map((item) => {
      const seen = days.get(item.key);
      return seen == null
        ? item
        : { ...item, amount: Math.min(item.amount, seen.largest * multiple) };
    }),
  };
}
