import { civilDaysBetween } from "@/modules/ledger/domain/period";
import { mostLikelyRunLengths, type MeasurementPrior } from "./changepoints";
import type { HistoryRow } from "./series";

/** The chance, any given week, that the way of spending changes: about once every four months. */
const WEEKLY_HAZARD = 1 / 16;
/** A regime younger than this many weeks may be one odd week, not a new way of living. */
const MIN_WEEKS_SINCE = 2;
/** Fewer whole weeks than this are too few to tell a change from noise. */
const MIN_WEEKS = 6;
/** How far either side of the week found the exact day is looked for. */
const REFINE_DAYS = 7;
/** The days compared on either side of a change. */
const COMPARE_DAYS = 28;
/** The days the dominant currency is read over. */
const DOMINANT_DAYS = 28;
/** Below these, a measurement's wander is a rounding of nothing; they keep a flat history from dividing by zero. */
const LOG_TOTAL_FLOOR = 0.02;
const SHARE_FLOOR = 0.002;
/**
 * How far either side of a change the typical week is read, and how far it
 * has to move for the change to count: about a third more or less a week, or
 * a third of the money going out in another currency.
 */
const MATERIAL_WEEKS = 8;
const MATERIAL_LOG_TOTAL = 0.3;
const MATERIAL_SHARE = 0.3;

/** What the ledger shows of the way life goes, day by day. */
export interface DailySignals {
  /** All spending of the day, in the main currency. */
  totals: Float64Array;
  /** The day's positive spending, the base the share is taken of. */
  positive: Float64Array;
  /** The part of `positive` spent in the currency spent most of lately. */
  dominant: Float64Array;
}

export interface LifeChange {
  /** The day in the series the current way of spending began. */
  day: number;
  /** Average spending a day over the four weeks before it, and since. */
  dailyBefore: number;
  dailyAfter: number;
}

/**
 * The day-by-day signals change detection reads, `start` for `length` days.
 * Which currency the money goes out in says where life is happening — a move
 * abroad shows in the currency before it shows in the totals.
 */
export function dailySignals(
  rows: readonly HistoryRow[],
  start: string,
  length: number
): DailySignals {
  const totals = new Float64Array(length);
  const positive = new Float64Array(length);
  const recentByCurrency = new Map<string, number>();
  for (const row of rows) {
    const day = civilDaysBetween(start, row.date);
    if (day < 0 || day >= length) continue;
    const amount = Number(row.amount);
    totals[day] = totals[day]! + amount;
    if (amount <= 0) continue;
    positive[day] = positive[day]! + amount;
    if (day >= length - DOMINANT_DAYS) {
      recentByCurrency.set(row.currency, (recentByCurrency.get(row.currency) ?? 0) + amount);
    }
  }
  let dominantCurrency: string | null = null;
  for (const [currency, amount] of recentByCurrency) {
    if (dominantCurrency == null || amount > recentByCurrency.get(dominantCurrency)!) {
      dominantCurrency = currency;
    }
  }
  const dominant = new Float64Array(length);
  for (const row of rows) {
    const day = civilDaysBetween(start, row.date);
    const amount = Number(row.amount);
    if (day < 0 || day >= length || amount <= 0 || row.currency !== dominantCurrency) continue;
    dominant[day] = dominant[day]! + amount;
  }
  return { totals, positive, dominant };
}

/**
 * When the current way of spending began, if it began within the history.
 *
 * Weeks are read rather than days: a day is mostly noise — a dinner out, a
 * week's shopping — while a week has a level. Two things are watched: how much
 * a week costs, on a log scale so that doubling counts the same at any level,
 * and how much of it went out in the currency spent most of lately. The week
 * the current regime began is then narrowed to the day that best splits the
 * days either side of it.
 */
export function detectLifeChange(signals: DailySignals): LifeChange | null {
  const length = signals.totals.length;
  const weeks = Math.floor(length / 7);
  if (weeks < MIN_WEEKS) return null;
  const offset = length - weeks * 7;

  const weeklyLogTotal: number[] = [];
  const weeklyShare: number[] = [];
  for (let week = 0; week < weeks; week++) {
    let total = 0;
    let positive = 0;
    let dominant = 0;
    for (let day = offset + week * 7; day < offset + week * 7 + 7; day++) {
      total += signals.totals[day]!;
      positive += signals.positive[day]!;
      dominant += signals.dominant[day]!;
    }
    weeklyLogTotal.push(Math.log1p(Math.max(0, total)));
    weeklyShare.push(positive > 0 ? dominant / positive : Number.NaN);
  }

  const lengths = mostLikelyRunLengths(
    weeklyLogTotal.map((value, week) => [value, weeklyShare[week]!]),
    [priorOf(weeklyLogTotal, LOG_TOTAL_FLOOR), priorOf(weeklyShare, SHARE_FLOOR)],
    WEEKLY_HAZARD
  );
  // A regime that only follows one odd week looks new to the detector without
  // being new: the week the odd one ended is not when life changed. Such a
  // start is passed over for the start of the regime before it.
  let last = lengths[weeks - 1]! >= MIN_WEEKS_SINCE ? weeks - 1 : weeks - 2;
  let startWeek = last - lengths[last]! + 1;
  while (
    startWeek > 0 &&
    !isMaterial(weeklyLogTotal, MATERIAL_LOG_TOTAL, startWeek) &&
    !isMaterial(weeklyShare, MATERIAL_SHARE, startWeek)
  ) {
    last = startWeek - 1;
    startWeek = last - lengths[last]! + 1;
  }
  if (startWeek <= 0) return null;

  const day = refineDay(signals, offset + startWeek * 7);
  return {
    day,
    dailyBefore: mean(signals.totals, Math.max(0, day - COMPARE_DAYS), day),
    dailyAfter: mean(signals.totals, day, length),
  };
}

/** Whether the typical week moves by at least `threshold` at `week`, read by medians so that one odd week cannot move it. */
function isMaterial(values: readonly number[], threshold: number, week: number): boolean {
  const before = values.slice(Math.max(0, week - MATERIAL_WEEKS), week);
  const after = values.slice(week, week + MATERIAL_WEEKS);
  const present = (part: number[]) => part.filter((value) => !Number.isNaN(value));
  if (present(before).length === 0 || present(after).length === 0) return false;
  return Math.abs(median(present(after)) - median(present(before))) >= threshold;
}

/** The day near `around` that splits the days either side of it into the two most uniform halves. */
function refineDay(signals: DailySignals, around: number): number {
  const length = signals.totals.length;
  const logTotals = Array.from(signals.totals, (total) => Math.log1p(Math.max(0, total)));
  const shares = Array.from(signals.positive, (positive, day) =>
    positive > 0 ? signals.dominant[day]! / positive : Number.NaN
  );
  const features = [
    { values: logTotals, variance: priorOf(logTotals, LOG_TOTAL_FLOOR).variance },
    { values: shares, variance: priorOf(shares, SHARE_FLOOR).variance },
  ];
  let best = around;
  let bestCost = Number.POSITIVE_INFINITY;
  const first = Math.max(1, around - REFINE_DAYS);
  const lastCandidate = Math.min(length - 1, around + REFINE_DAYS);
  for (let split = first; split <= lastCandidate; split++) {
    const from = Math.max(0, split - COMPARE_DAYS);
    const to = Math.min(length, split + COMPARE_DAYS);
    let cost = 0;
    for (const feature of features) {
      cost +=
        (squaredError(feature.values, from, split) + squaredError(feature.values, split, to)) /
        feature.variance;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = split;
    }
  }
  return best;
}

/** The sum of squared distances from the mean over `from` up to `to`, missing values left out. */
function squaredError(values: readonly number[], from: number, to: number): number {
  let count = 0;
  let sum = 0;
  let squares = 0;
  for (let index = from; index < to; index++) {
    const value = values[index]!;
    if (Number.isNaN(value)) continue;
    count++;
    sum += value;
    squares += value * value;
  }
  return count === 0 ? 0 : squares - (sum * sum) / count;
}

function mean(values: Float64Array, from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  for (let index = from; index < to; index++) sum += values[index]!;
  return sum / (to - from);
}

/**
 * A measurement's prior from its own history: its median level, and how much
 * it wanders from one step to the next. Steps are compared with their
 * neighbours rather than the overall mean, so a change of level — the thing to
 * be found — does not count as wandering.
 */
function priorOf(values: readonly number[], floor: number): MeasurementPrior {
  const present = values.filter((value) => !Number.isNaN(value));
  if (present.length === 0) return { mean: 0, variance: floor };
  const steps: number[] = [];
  for (let index = 1; index < present.length; index++) {
    steps.push(Math.abs(present[index]! - present[index - 1]!));
  }
  // For normal noise, the median step between neighbours is 0.6745·√2 standard deviations.
  const spread = median(steps) / (0.6745 * Math.SQRT2);
  return { mean: median(present), variance: Math.max(floor, spread * spread) };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
