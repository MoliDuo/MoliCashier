import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import type { DayModel } from "./day-model";
import { categoryKeyOf, type HistoryRow } from "./series";

export type Cadence = "weekly" | "biweekly" | "monthly";

/** A bill that comes back on a schedule, found in the ledger without being told. */
export interface RecurringBill {
  /** What the latest one was called. */
  label: string;
  categoryKey: string;
  cadence: Cadence;
  /** What one costs: the middle of the latest few. */
  amount: number;
  /** How many came in a row on schedule, the latest included. */
  streak: number;
  lastDate: string;
  /** The documents that make it up, so the everyday models can leave them out. */
  documentIds: ReadonlySet<string>;
}

interface CadenceRule {
  cadence: Cadence;
  /** The typical gap, in days, and how far one gap may stray from it. */
  days: number;
  slack: number;
}

const CADENCES: readonly CadenceRule[] = [
  { cadence: "weekly", days: 7, slack: 1 },
  { cadence: "biweekly", days: 14, slack: 2 },
  { cadence: "monthly", days: 30, slack: 4 },
];

/** Fewer than this many in a row is a coincidence, not a schedule. */
const MIN_OCCURRENCES = 3;
/** How many of the latest gaps and amounts are read; an older irregularity is forgiven. */
const RECENT = 5;
/** How far one of the latest amounts may stray from their middle and still be the same bill. */
const AMOUNT_TOLERANCE = 0.2;

interface Occurrence {
  date: string;
  amount: number;
  label: string;
  documentIds: Set<string>;
}

/**
 * The text that names a bill, with what changes from one to the next taken
 * out: "10月房租" and "11月房租" are the same bill, as are "Netflix #2291"
 * and "Netflix #2304".
 */
export function billKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[\d年月日号期#.,:/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The bills in the history that come back weekly, fortnightly or monthly at a
 * steady amount, and are still coming: the latest is no more than one gap and
 * its slack before `today`.
 *
 * Documents are the unit: a bill is one receipt, however many lines it has.
 * Its category is that of its largest line.
 */
export function detectRecurringBills(rows: readonly HistoryRow[], today: string): RecurringBill[] {
  const documents = new Map<
    string,
    { date: string; label: string; amount: number; largest: number; categoryKey: string }
  >();
  for (const row of rows) {
    if (row.documentId == null || row.label == null || row.date > today) continue;
    const amount = Number(row.amount);
    const document = documents.get(row.documentId);
    if (document == null) {
      documents.set(row.documentId, {
        date: row.date,
        label: row.label,
        amount,
        largest: amount,
        categoryKey: categoryKeyOf(row.categoryId),
      });
      continue;
    }
    document.amount += amount;
    if (amount > document.largest) {
      document.largest = amount;
      document.categoryKey = categoryKeyOf(row.categoryId);
    }
  }

  const groups = new Map<string, { categoryKey: string; byDate: Map<string, Occurrence> }>();
  for (const [documentId, document] of documents) {
    const key = billKey(document.label);
    if (key === "" || document.amount <= 0) continue;
    const groupKey = `${document.categoryKey}\u0000${key}`;
    let group = groups.get(groupKey);
    if (group == null) {
      group = { categoryKey: document.categoryKey, byDate: new Map() };
      groups.set(groupKey, group);
    }
    const occurrence = group.byDate.get(document.date);
    if (occurrence == null) {
      group.byDate.set(document.date, {
        date: document.date,
        amount: document.amount,
        label: document.label,
        documentIds: new Set([documentId]),
      });
    } else {
      occurrence.amount += document.amount;
      occurrence.documentIds.add(documentId);
    }
  }

  const bills: RecurringBill[] = [];
  for (const group of groups.values()) {
    const occurrences = [...group.byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const bill = recurringBillOf(occurrences, group.categoryKey, today);
    if (bill != null) bills.push(bill);
  }
  return bills.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

function recurringBillOf(
  occurrences: readonly Occurrence[],
  categoryKey: string,
  today: string
): RecurringBill | null {
  if (occurrences.length < MIN_OCCURRENCES) return null;
  const recent = occurrences.slice(-(RECENT + 1));
  const gaps = recent
    .slice(1)
    .map((occurrence, index) => civilDaysBetween(recent[index]!.date, occurrence.date));
  const typicalGap = median(gaps);
  const rule = CADENCES.find(
    (candidate) => Math.abs(typicalGap - candidate.days) <= candidate.slack
  );
  if (rule == null) return null;

  // The streak runs back from the latest for as long as the gaps keep to the schedule.
  let streak = 1;
  for (let index = occurrences.length - 1; index > 0; index--) {
    const gap = civilDaysBetween(occurrences[index - 1]!.date, occurrences[index]!.date);
    if (Math.abs(gap - rule.days) > rule.slack) break;
    streak++;
  }
  if (streak < MIN_OCCURRENCES) return null;

  const amounts = recent.slice(-MIN_OCCURRENCES).map((occurrence) => occurrence.amount);
  const amount = median(amounts);
  if (amounts.some((value) => Math.abs(value - amount) > AMOUNT_TOLERANCE * amount)) return null;

  const last = occurrences.at(-1)!;
  if (civilDaysBetween(last.date, today) > rule.days + rule.slack) return null;

  const documentIds = new Set<string>();
  for (const occurrence of occurrences.slice(-streak)) {
    for (const id of occurrence.documentIds) documentIds.add(id);
  }
  return {
    label: last.label,
    categoryKey,
    cadence: rule.cadence,
    amount,
    streak,
    lastDate: last.date,
    documentIds,
  };
}

/**
 * The days after `today`, through `end`, a bill is expected on. A monthly
 * bill keeps its day of the month (the 31st falls on a short month's last
 * day); the others keep their gap. One already due and not yet recorded is
 * expected tomorrow.
 */
export function upcomingDates(bill: RecurringBill, today: string, end: string): string[] {
  const dates: string[] = [];
  const tomorrow = addCivilDays(today, 1);
  for (let step = 1; ; step++) {
    const date = nthAfter(bill, step);
    if (date > end) break;
    if (date <= today) {
      if (dates.length === 0 && step === 1 && tomorrow <= end) dates.push(tomorrow);
      continue;
    }
    if (!dates.includes(date)) dates.push(date);
  }
  return dates;
}

function nthAfter(bill: RecurringBill, step: number): string {
  if (bill.cadence !== "monthly") {
    return addCivilDays(bill.lastDate, step * (bill.cadence === "weekly" ? 7 : 14));
  }
  const [year, month, day] = bill.lastDate.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 + step, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** A bill as a model the simulation can play: its amount, for certain, on the days it is due. */
export function billDayModel(bill: RecurringBill, today: string, end: string): DayModel {
  const due = new Set(upcomingDates(bill, today, end).map((date) => civilDaysBetween(today, date)));
  return {
    chance: (day) => (due.has(day) ? 1 : 0),
    amount: () => bill.amount,
  };
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
