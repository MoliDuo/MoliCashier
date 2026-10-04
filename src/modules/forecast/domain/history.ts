import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { fitBaselineModel } from "./baseline";
import type { DayModel } from "./day-model";
import { dailySignals, detectLifeChange, type DailySignals, type LifeChange } from "./life-change";
import { billDayModel, detectRecurringBills, type RecurringBill } from "./recurring";
import { buildDailySeries, weekdayOf, type DailySeries, type HistoryRow } from "./series";
import { recencyWeights } from "./weights";

/** The history as every model reads it, standing at the start of `today`. */
export interface PreparedHistory {
  today: string;
  /** The first day recorded. */
  earliest: string;
  /** Every category's days from `earliest` through yesterday, the recurring bills taken out. */
  series: DailySeries;
  signals: DailySignals;
  /** When the current way of spending began, if within the history. */
  change: LifeChange | null;
  bills: RecurringBill[];
}

/**
 * Lays out the rows recorded before `today` for the models: day by day per
 * category, with the bills that come back on a schedule taken out (they are
 * added back on their days, for certain, rather than left to chance), and the
 * latest change in the way of spending found.
 *
 * Returns null with fewer than `minHistoryDays` days recorded before today.
 */
export function prepareHistory(
  rows: readonly HistoryRow[],
  today: string,
  minHistoryDays: number
): PreparedHistory | null {
  const earliest = rows.reduce<string | null>(
    (first, row) => (row.date < today && (first == null || row.date < first) ? row.date : first),
    null
  );
  if (earliest == null || civilDaysBetween(earliest, today) < minHistoryDays) return null;

  const before = rows.filter((row) => row.date < today);
  const bills = detectRecurringBills(before, addCivilDays(today, -1));
  const billDocuments = new Set(bills.flatMap((bill) => [...bill.documentIds]));
  const everyday =
    billDocuments.size === 0
      ? before
      : before.filter((row) => row.documentId == null || !billDocuments.has(row.documentId));
  const series = buildDailySeries(everyday, earliest, addCivilDays(today, -1));
  const signals = dailySignals(before, earliest, series.length);
  return { today, earliest, series, signals, change: detectLifeChange(signals), bills };
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
