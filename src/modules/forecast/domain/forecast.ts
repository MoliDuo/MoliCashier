import { add, compare } from "@/lib/money/decimal";
import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { fitBaselineModel } from "./baseline";
import type { DayModel } from "./day-model";
import { seededRandom } from "./random";
import { buildDailySeries, categoryKeyOf, weekdayOf, type HistoryRow } from "./series";
import { quantilesOf, simulate, type Quantiles } from "./simulate";
import { recencyWeights } from "./weights";

export interface ForecastOptions {
  /** How fast the past fades; null counts every day the same. */
  halfLifeDays: number | null;
  /** How many times the remaining days are played out. */
  paths: number;
  seed: number;
  /** Fewer recorded days than this before today are too few to forecast from. */
  minHistoryDays: number;
}

export interface CategoryForecast {
  key: string;
  /** Spent so far this period, exactly. */
  spent: string;
  /** Where the whole period ends up for this category, spent days included. */
  forecast: Quantiles;
}

export interface PeriodForecast {
  /** The first day the models learnt from. */
  historyFrom: string;
  spent: string;
  /** Where the whole period ends up, spent days included. */
  total: Quantiles;
  /** The period's running total at the end of each remaining day, tomorrow first. */
  running: Quantiles[];
  /** Every category spent in so far or expected to be, the largest expected first. */
  categories: CategoryForecast[];
  /** The previous period's whole total, and the share of outcomes that end above it. */
  exceedPrevious: { total: string; probability: number } | null;
}

/** A category expected to cost less than this, with nothing spent yet, is left off the list. */
const NEGLIGIBLE_AMOUNT = 0.005;

/**
 * Where a running period is heading, per category and in total. Every day
 * recorded before today teaches the models, recent days most; today counts as
 * spent but not as a day to learn from, since it is not over. The remaining
 * days, tomorrow through `period.end`, are simulated.
 *
 * Returns null for a period with no days left, or a ledger with too little
 * history to say anything.
 */
export function forecastPeriod(input: {
  rows: readonly HistoryRow[];
  today: string;
  period: { from: string; end: string };
  previous: { from: string; to: string } | null;
  options: ForecastOptions;
}): PeriodForecast | null {
  const { rows, today, period, previous, options } = input;
  const remaining = civilDaysBetween(today, period.end);
  if (remaining <= 0) return null;

  const earliest = rows.reduce<string | null>(
    (first, row) => (row.date <= today && (first == null || row.date < first) ? row.date : first),
    null
  );
  if (earliest == null || civilDaysBetween(earliest, today) < options.minHistoryDays) return null;

  const series = buildDailySeries(rows, earliest, addCivilDays(today, -1));
  const weights = recencyWeights(series.length, options.halfLifeDays);
  const models = new Map<string, DayModel>();
  for (const [key, values] of series.byCategory) {
    const model = fitBaselineModel({
      values,
      weights,
      length: series.length,
      firstWeekday: weekdayOf(earliest),
      todayWeekday: weekdayOf(today),
    });
    if (model != null) models.set(key, model);
  }

  const simulation = simulate(models, {
    days: remaining,
    paths: options.paths,
    random: seededRandom(options.seed),
  });

  const spentByKey = new Map<string, string>();
  let spent = "0";
  let previousTotal = "0";
  for (const row of rows) {
    if (row.date >= period.from && row.date <= today) {
      const key = categoryKeyOf(row.categoryId);
      spentByKey.set(key, add(spentByKey.get(key) ?? "0", row.amount));
      spent = add(spent, row.amount);
    } else if (previous != null && row.date >= previous.from && row.date <= previous.to) {
      previousTotal = add(previousTotal, row.amount);
    }
  }

  const spentNumber = Number(spent);
  const totals = simulation.running[remaining - 1]!;
  const categories: CategoryForecast[] = [];
  for (const key of new Set([...spentByKey.keys(), ...simulation.byCategory.keys()])) {
    const categorySpent = spentByKey.get(key) ?? "0";
    const sums = simulation.byCategory.get(key);
    const forecast =
      sums == null
        ? { p10: Number(categorySpent), p50: Number(categorySpent), p90: Number(categorySpent) }
        : quantilesOf(sums, Number(categorySpent));
    if (
      compare(categorySpent, "0") === 0 &&
      Math.max(Math.abs(forecast.p10), Math.abs(forecast.p90)) < NEGLIGIBLE_AMOUNT
    ) {
      continue;
    }
    categories.push({ key, spent: categorySpent, forecast });
  }
  categories.sort((a, b) => b.forecast.p50 - a.forecast.p50 || a.key.localeCompare(b.key));

  const previousNumber = Number(previousTotal);
  const exceedPrevious =
    previous == null || previousNumber <= 0
      ? null
      : {
          total: previousTotal,
          probability:
            totals.reduce(
              (count, total) => count + (spentNumber + total > previousNumber ? 1 : 0),
              0
            ) / totals.length,
        };

  return {
    historyFrom: earliest,
    spent,
    total: quantilesOf(totals, spentNumber),
    running: simulation.running.map((column) => quantilesOf(column, spentNumber)),
    categories,
    exceedPrevious,
  };
}
