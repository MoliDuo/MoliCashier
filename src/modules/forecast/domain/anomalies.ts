import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import type { PreparedHistory } from "./history";
import { buildDailySeries, type HistoryRow } from "./series";
import { recencyWeights } from "./weights";

/** A day a category cost far more than it usually does on a day it spends. */
export interface Anomaly {
  date: string;
  key: string;
  amount: number;
  /** What a day with spending in the category usually costs: the middle of them. */
  typical: number;
}

/** Fewer days with spending than this before the period say too little about "usual". */
const MIN_SPENDING_DAYS = 8;
/** An unusual day is above this share of the usual days with spending… */
const UNUSUAL_SHARE = 0.95;
/** …and at least this many times the middle one. */
const UNUSUAL_RATIO = 2;
const MAX_ANOMALIES = 3;

/**
 * The days of a period so far, today included, on which a category cost more
 * than nineteen in twenty of its days with spending before the period, and at
 * least twice its middle one. "Before" is read with the past faded, so a
 * category that has simply grown is measured against its recent days. The
 * recurring bills are left out: rent day is not a surprise.
 *
 * The most unusual first, at most three.
 */
export function findAnomalies(input: {
  rows: readonly HistoryRow[];
  history: PreparedHistory;
  from: string;
  halfLifeDays: number | null;
}): Anomaly[] {
  const { rows, history, from, halfLifeDays } = input;
  const before = civilDaysBetween(history.earliest, from);
  if (before <= 0) return [];
  const billDocuments = new Set(history.bills.flatMap((bill) => [...bill.documentIds]));
  const series = buildDailySeries(
    rows.filter((row) => row.documentId == null || !billDocuments.has(row.documentId)),
    history.earliest,
    history.today
  );
  const weights = recencyWeights(before, halfLifeDays);

  const anomalies: Anomaly[] = [];
  for (const [key, values] of series.byCategory) {
    const days: { amount: number; weight: number }[] = [];
    for (let day = 0; day < before; day++) {
      if (values[day]! > 0) days.push({ amount: values[day]!, weight: weights[day]! });
    }
    if (days.length < MIN_SPENDING_DAYS) continue;
    days.sort((a, b) => a.amount - b.amount);
    const typical = weightedQuantile(days, 0.5);
    const threshold = Math.max(weightedQuantile(days, UNUSUAL_SHARE), typical * UNUSUAL_RATIO);
    for (let day = before; day < series.length; day++) {
      const amount = values[day]!;
      if (amount > threshold) {
        anomalies.push({ date: addCivilDays(history.earliest, day), key, amount, typical });
      }
    }
  }
  return anomalies
    .sort((a, b) => b.amount / b.typical - a.amount / a.typical || a.date.localeCompare(b.date))
    .slice(0, MAX_ANOMALIES);
}

/** The amount a share `q` of the weight falls at or below, `days` sorted by amount. */
function weightedQuantile(days: readonly { amount: number; weight: number }[], q: number): number {
  const total = days.reduce((sum, day) => sum + day.weight, 0);
  let running = 0;
  for (const day of days) {
    running += day.weight;
    if (running >= q * total) return day.amount;
  }
  return days.at(-1)!.amount;
}
