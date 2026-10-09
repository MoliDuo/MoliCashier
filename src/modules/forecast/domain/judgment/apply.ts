import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import type { CategoryForecast, PeriodForecast } from "../forecast";
import { categoryKeyOf, type HistoryRow } from "../series";
import type { Quantiles } from "../simulate";
import type { JudgedDocument, JudgedExpected, Judgment } from "./schema";

/**
 * A recurring bill the statistical model found, or a purchase recorded since
 * the judgment, this close to an expected charge in the same category is
 * taken for that charge.
 */
const SAME_CHARGE_DAYS = 7;
/** A purchase recorded since the judgment pays an expected charge when it is at least this share of it. */
const PAID_SHARE = 0.5;

/**
 * The charges the AI expects after `today` through `end` that the forecast
 * does not count already: not a recurring bill the statistical model found
 * due near the same day in the same category, and not paid by a purchase in
 * that category recorded since the judgment, near the day and of about its
 * size — a tuition paid two days early is not paid again.
 */
export function expectedCharges(input: {
  judgment: Judgment;
  /** The day judged. */
  asOf: string;
  rows: readonly HistoryRow[];
  forecast: PeriodForecast;
  today: string;
  end: string;
}): JudgedExpected[] {
  const { judgment, asOf, rows, forecast, today, end } = input;
  const recorded = new Map<string, { date: string; key: string; total: number }>();
  for (const row of rows) {
    if (row.date <= asOf || row.date > today) continue;
    const id = row.documentId ?? `${row.date}:${categoryKeyOf(row.categoryId)}`;
    const purchase = recorded.get(id) ?? {
      date: row.date,
      key: categoryKeyOf(row.categoryId),
      total: 0,
    };
    purchase.total += Number(row.amount);
    recorded.set(id, purchase);
  }
  const near = (a: string, b: string) => Math.abs(civilDaysBetween(a, b)) <= SAME_CHARGE_DAYS;
  return judgment.expected.filter(
    (item) =>
      item.date > today &&
      item.date <= end &&
      !forecast.upcoming.some((bill) => bill.key === item.key && near(bill.date, item.date)) &&
      ![...recorded.values()].some(
        (purchase) =>
          purchase.key === item.key &&
          near(purchase.date, item.date) &&
          purchase.total >= item.amount * PAID_SHARE
      )
  );
}

/**
 * The forecast with `charges` added on their days, for certain: to their
 * categories, to the running total from their day on, and to the total. A
 * certain amount moves every outcome alike, so each quantile moves by it.
 */
export function withExpectedCharges(
  forecast: PeriodForecast,
  charges: readonly JudgedExpected[],
  today: string
): PeriodForecast {
  if (charges.length === 0) return forecast;
  const byKey = new Map<string, number>();
  for (const charge of charges) byKey.set(charge.key, (byKey.get(charge.key) ?? 0) + charge.amount);

  const categories: CategoryForecast[] = forecast.categories.map((category) => ({
    ...category,
    forecast: shift(category.forecast, byKey.get(category.key) ?? 0),
  }));
  for (const [key, amount] of byKey) {
    if (categories.some((category) => category.key === key)) continue;
    categories.push({ key, spent: "0", forecast: { p10: amount, p50: amount, p90: amount } });
  }
  categories.sort((a, b) => b.forecast.p50 - a.forecast.p50 || a.key.localeCompare(b.key));

  const running = forecast.running.map((day, index) => {
    const date = addCivilDays(today, index + 1);
    return shift(
      day,
      charges.reduce((sum, charge) => sum + (charge.date <= date ? charge.amount : 0), 0)
    );
  });
  return { ...forecast, categories, running, total: running.at(-1) ?? forecast.total };
}

function shift(quantiles: Quantiles, by: number): Quantiles {
  return { p10: quantiles.p10 + by, p50: quantiles.p50 + by, p90: quantiles.p90 + by };
}

/** The documents recorded from `from` through `today` that the AI judged not everyday spending. */
export function judgedDocumentsIn(
  judgment: Judgment,
  rows: readonly HistoryRow[],
  from: string,
  today: string
): JudgedDocument[] {
  const judged = new Map(judgment.documents.map((document) => [document.documentId, document]));
  const found = new Map<string, JudgedDocument>();
  for (const row of rows) {
    if (row.date < from || row.date > today || row.documentId == null) continue;
    const document = judged.get(row.documentId);
    if (document != null) found.set(document.documentId, document);
  }
  return [...found.values()];
}
