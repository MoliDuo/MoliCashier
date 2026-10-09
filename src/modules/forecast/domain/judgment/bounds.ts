import { categoryKeyOf, type HistoryRow } from "../series";
import type { Judgment } from "./schema";

/** Every category's largest past day with spending before `today`. */
function largestDays(rows: readonly HistoryRow[], today: string): Map<string, number> {
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
  const result = new Map<string, number>();
  for (const [key, days] of totals) {
    const largest = Math.max(...days.values());
    if (largest > 0) result.set(key, largest);
  }
  return result;
}

/**
 * The judgment with each expected charge held to `multiple` times its
 * category's largest past day. The AI judges, and the code sums; an answer
 * that read a year's fees as one charge would otherwise multiply the
 * forecast. A category with no past spending has nothing to hold it to and is
 * left as judged.
 */
export function boundJudgment(
  judgment: Judgment,
  rows: readonly HistoryRow[],
  today: string,
  multiple: number
): Judgment {
  const largest = largestDays(rows, today);
  return {
    ...judgment,
    expected: judgment.expected.map((item) => {
      const seen = largest.get(item.key);
      return seen == null ? item : { ...item, amount: Math.min(item.amount, seen * multiple) };
    }),
  };
}
