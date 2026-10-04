import { add, compare } from "@/lib/money/decimal";
import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { findAnomalies, type Anomaly } from "./anomalies";
import { dayWeights, prepareHistory } from "./history";
import type { NetworkModel } from "./nn/network";
import { simulateOutlook } from "./outlook";
import { seededRandom } from "./random";
import { upcomingDates, type Cadence } from "./recurring";
import { categoryKeyOf, type HistoryRow } from "./series";
import { quantilesOf, type Quantiles } from "./simulate";

export interface ForecastOptions {
  /** How fast the past fades; null counts every day the same. */
  halfLifeDays: number | null;
  /**
   * What a day from before the current way of spending began still counts
   * for, against a day since: enough to lend its weekly rhythm and its mix of
   * categories while the new way has few days of its own, too little to set
   * the level.
   */
  changeDiscount: number;
  /** How many times the remaining days are played out. */
  paths: number;
  seed: number;
  /** Fewer recorded days than this before today are too few to forecast from. */
  minHistoryDays: number;
  /** The trained network, and the share of the paths it plays; null leaves it out. */
  network: NetworkModel | null;
  networkShare: number;
  /** How many paths each category hands the browser for its what-if. */
  samples: number;
}

export interface CategoryForecast {
  key: string;
  /** Spent so far this period, exactly. */
  spent: string;
  /** Where the whole period ends up for this category, spent days included. */
  forecast: Quantiles;
  /**
   * What the rest of the period costs in the category on a sample of the
   * paths, the same paths in every category, so the browser can scale one
   * category and add the paths back up.
   */
  samples: number[];
}

/** A recurring bill expected before the period ends. */
export interface UpcomingBill {
  date: string;
  label: string;
  key: string;
  amount: number;
  cadence: Cadence;
  streak: number;
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
  /** When the current way of spending began, if the history shows it begin. */
  lifeChange: LifeChangeSummary | null;
  /** The recurring bills expected after today through the period's end, soonest first. */
  upcoming: UpcomingBill[];
  /** The days so far that cost a category far more than usual. */
  anomalies: Anomaly[];
}

export interface LifeChangeSummary {
  date: string;
  /** Average spending a day over the four weeks before it, and since. */
  dailyBefore: number;
  dailyAfter: number;
}

/** A category expected to cost less than this, with nothing spent yet, is left off the list. */
const NEGLIGIBLE_AMOUNT = 0.005;

/**
 * Where a running period is heading, per category and in total. Every day
 * recorded before today teaches the models, recent days most; today counts as
 * spent but not as a day to learn from, since it is not over. The remaining
 * days, tomorrow through `period.end`, are simulated.
 *
 * When the history shows the way of spending change — a move, a new
 * household — the days before the change count for less, so the forecast
 * follows the life being lived now rather than the average of every life the
 * ledger has seen.
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
  const history = prepareHistory(rows, today, options.minHistoryDays);
  if (history == null) return null;

  const simulation = simulateOutlook(history, {
    weights: dayWeights(history, options.halfLifeDays, options.changeDiscount),
    network: options.network,
    networkShare: options.networkShare,
    end: period.end,
    paths: options.paths,
    random: seededRandom(options.seed),
  });
  const pathCount = simulation.running[0]!.length;
  const sampled = Array.from({ length: Math.min(options.samples, pathCount) }, (_, index) =>
    Math.floor((index * pathCount) / Math.min(options.samples, pathCount))
  );

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
    categories.push({
      key,
      spent: categorySpent,
      forecast,
      samples: sums == null ? [] : sampled.map((path) => sums[path]!),
    });
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
    historyFrom: history.earliest,
    spent,
    total: quantilesOf(totals, spentNumber),
    running: simulation.running.map((column) => quantilesOf(column, spentNumber)),
    categories,
    exceedPrevious,
    lifeChange:
      history.change == null
        ? null
        : {
            date: addCivilDays(history.earliest, history.change.day),
            dailyBefore: history.change.dailyBefore,
            dailyAfter: history.change.dailyAfter,
          },
    upcoming: history.bills
      .flatMap((bill) =>
        upcomingDates(bill, today, period.end).map((date) => ({
          date,
          label: bill.label,
          key: bill.categoryKey,
          amount: bill.amount,
          cadence: bill.cadence,
          streak: bill.streak,
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount),
    anomalies: findAnomalies({
      rows,
      history,
      from: period.from,
      halfLifeDays: options.halfLifeDays,
    }),
  };
}
