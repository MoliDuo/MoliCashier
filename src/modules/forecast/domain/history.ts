import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { fitBaselineModel } from "./baseline";
import type { DayModel } from "./day-model";
import { dailySignals, detectLifeChange, type DailySignals, type LifeChange } from "./life-change";
import {
  billDayModel,
  detectRecurringBills,
  withRecordedOn,
  type RecurringBill,
} from "./recurring";
import {
  buildDailySeries,
  categoryKeyOf,
  weekdayOf,
  type DailySeries,
  type HistoryRow,
} from "./series";
import { quantile } from "./simulate";
import { recencyWeights } from "./weights";

/** The history as every model reads it, standing at the start of `today`. */
export interface PreparedHistory {
  today: string;
  /** The first day recorded. */
  earliest: string;
  /**
   * Every category's days from `earliest` through yesterday, with the
   * recurring bills, the large one-off purchases and the documents judged not
   * everyday taken out.
   */
  series: DailySeries;
  signals: DailySignals;
  /** When the current way of spending began, if within the history. */
  change: LifeChange | null;
  bills: RecurringBill[];
  /** A single purchase of at least this much is a large one-off, and is not forecast. */
  largeFrom: number | null;
}

/** A purchase this many times the usual day with spending is a large one-off… */
const LARGE_PURCHASE_MULTIPLE = 5;
/** …the usual day read over the last eight weeks and over all of the history, whichever is more. */
const LARGE_PURCHASE_WINDOW_DAYS = 56;

/**
 * How much a single purchase must cost to count as a large one-off: five
 * times the middle day with spending, recently or over the whole history,
 * whichever is more — so that after life gets cheaper, an ordinary day of the
 * old life is not taken for a one-off. Tuition, a deposit, a flight or a sofa
 * come when they come; drawing them into the days ahead because one came last
 * month is what made a category with nothing spent yet expect thousands. They
 * count once recorded, and are not forecast.
 */
function largePurchaseThreshold(rows: readonly HistoryRow[], today: string): number | null {
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.date, (byDay.get(row.date) ?? 0) + Number(row.amount));
  const from = addCivilDays(today, -LARGE_PURCHASE_WINDOW_DAYS);
  const all = [...byDay].filter(([, total]) => total > 0);
  if (all.length === 0) return null;
  const middle = (days: [string, number][]) =>
    days.length === 0 ? 0 : quantile(Float64Array.from(days, ([, total]) => total).sort(), 0.5);
  const usual = Math.max(middle(all), middle(all.filter(([date]) => date >= from)));
  return usual * LARGE_PURCHASE_MULTIPLE;
}

/**
 * The purchases — whole documents — that cost at least `threshold`, and the
 * refunds that give back as much: a deposit returned or a flight refunded is
 * as much a one-off as the purchase was, and drawn as an everyday day it would
 * pull every path ahead down by its amount.
 */
function largePurchases(rows: readonly HistoryRow[], threshold: number): Set<string> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = purchaseOf(row);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.amount));
  }
  return new Set(
    [...totals].filter(([, total]) => Math.abs(total) >= threshold).map(([key]) => key)
  );
}

/** The purchase a row belongs to: its document, or its day and category when it has none. */
function purchaseOf(row: HistoryRow): string {
  return row.documentId ?? `${row.date}:${categoryKeyOf(row.categoryId)}`;
}

/**
 * Lays out the rows recorded before `today` for the models: day by day per
 * category, with the bills that come back on a schedule taken out (they are
 * added back on their days, for certain, rather than left to chance), the
 * large one-off purchases taken out (they are not forecast at all), and the
 * latest change in the way of spending found. The documents in `notEveryday`
 * — those the AI analyst judged one-off or recurring — are taken out of the
 * everyday days too, after the bills are found, so a bill both found is still
 * added on its day.
 *
 * Returns null with fewer than `minHistoryDays` days recorded before today.
 */
export function prepareHistory(
  rows: readonly HistoryRow[],
  today: string,
  minHistoryDays: number,
  notEveryday: ReadonlySet<string> = new Set()
): PreparedHistory | null {
  const earliest = rows.reduce<string | null>(
    (first, row) => (row.date < today && (first == null || row.date < first) ? row.date : first),
    null
  );
  if (earliest == null || civilDaysBetween(earliest, today) < minHistoryDays) return null;

  const before = rows.filter((row) => row.date < today);
  // A bill already recorded today counts as spent, and is not expected again tomorrow.
  const bills = withRecordedOn(detectRecurringBills(before, addCivilDays(today, -1)), rows, today);
  const billDocuments = new Set(bills.flatMap((bill) => [...bill.documentIds]));
  const regular =
    billDocuments.size === 0
      ? before
      : before.filter((row) => row.documentId == null || !billDocuments.has(row.documentId));
  const largeFrom = largePurchaseThreshold(regular, today);
  const large = largeFrom == null ? new Set<string>() : largePurchases(regular, largeFrom);
  const everyday =
    large.size === 0 && notEveryday.size === 0
      ? regular
      : regular.filter(
          (row) =>
            !large.has(purchaseOf(row)) &&
            (row.documentId == null || !notEveryday.has(row.documentId))
        );
  const series = buildDailySeries(everyday, earliest, addCivilDays(today, -1));
  // The way of spending is read from the everyday days too: a month of moving-in purchases is not a new way of life.
  const signals = dailySignals(everyday, earliest, series.length);
  return { today, earliest, series, signals, change: detectLifeChange(signals), bills, largeFrom };
}

/**
 * How much each day counts: recent days most, and the days before the
 * current way of spending began a share `changeDiscount` of that.
 */
export function dayWeights(
  history: PreparedHistory,
  halfLifeDays: number | null,
  changeDiscount: number
): Float64Array {
  const weights = recencyWeights(history.series.length, halfLifeDays);
  if (history.change != null) {
    for (let day = 0; day < history.change.day; day++) {
      weights[day] = weights[day]! * changeDiscount;
    }
  }
  return weights;
}

/** How slowly the long-run rate a category's recent rate leans on fades: over months, not weeks. */
const LONG_RUN_HALF_LIFE_DAYS = 120;

/** The statistical model of every category's everyday spending. */
export function statisticalModels(
  history: PreparedHistory,
  weights: Float64Array
): Map<string, DayModel> {
  const longRun = recencyWeights(history.series.length, LONG_RUN_HALF_LIFE_DAYS);
  const longRunTotal = longRun.reduce((sum, weight) => sum + weight, 0);
  const models = new Map<string, DayModel>();
  for (const [key, values] of history.series.byCategory) {
    let spent = 0;
    for (let day = 0; day < history.series.length; day++) {
      if (values[day] !== 0) spent += longRun[day]!;
    }
    const model = fitBaselineModel({
      values,
      weights,
      length: history.series.length,
      firstWeekday: weekdayOf(history.earliest),
      todayWeekday: weekdayOf(history.today),
      longRunChance: spent / longRunTotal,
    });
    if (model != null) models.set(key, model);
  }
  return models;
}

/** The recurring bills due after today through `end`, as models of their own. */
export function billModels(history: PreparedHistory, end: string): [string, DayModel][] {
  return history.bills.map((bill) => [bill.categoryKey, billDayModel(bill, history.today, end)]);
}
