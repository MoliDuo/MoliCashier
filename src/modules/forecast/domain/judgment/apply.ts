import { add, compare } from "@/lib/money/decimal";
import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { categoryKeyOf, type HistoryRow } from "../series";
import type { Quantiles } from "../simulate";
import type { JudgedDocument, Judgment, JudgmentTrend } from "./schema";

/** How a category is heading against the current phase's usual level. */
export interface CategoryTrend {
  direction: JudgmentTrend;
  /** The last two weeks against the phase's usual day, as a share: 0.25 reads "+25%". */
  change: number;
}

export interface JudgedCategoryForecast {
  key: string;
  spent: string;
  forecast: Quantiles;
  trend: CategoryTrend | null;
}

export interface JudgedPhaseSummary {
  from: string;
  /** The phase's last day; yesterday for the current one. */
  to: string;
  label: string;
  /** Everyday spending a day across the phase, the purchases judged not everyday left out; null for a phase begun today. */
  daily: number | null;
}

export interface JudgedPeriodForecast {
  spent: string;
  total: Quantiles;
  running: Quantiles[];
  categories: JudgedCategoryForecast[];
  phases: JudgedPhaseSummary[];
  /** The documents of the period so far that were judged not everyday. */
  documents: JudgedDocument[];
}

/** The recent days a trend reads. */
const TREND_DAYS = 14;
/** A phase shorter than this has no usual level apart from its recent days. */
const TREND_MIN_PHASE_DAYS = 28;
/** A change smaller than this share either way reads as steady. */
const TREND_STEADY_SHARE = 0.1;
/** A category expected to cost less than this, with nothing spent yet, is left off the list. */
const NEGLIGIBLE_AMOUNT = 0.005;

/**
 * The period's forecast from the AI's judgment: what each category has spent,
 * plus its judged everyday spending a day times the days left, plus what is
 * expected before the period ends. The low and high outcomes take the low and
 * high day; the total's spread adds the categories' spreads as independent
 * ones, so it is narrower than every category at its extreme at once.
 *
 * What was spent is read from `rows` now, so an entry recorded after the
 * judgment counts at once; the judgment itself is refreshed in the background.
 */
export function applyJudgment(input: {
  judgment: Judgment;
  rows: readonly HistoryRow[];
  today: string;
  period: { from: string; end: string };
}): JudgedPeriodForecast | null {
  const { judgment, rows, today, period } = input;
  const remaining = civilDaysBetween(today, period.end);
  if (remaining <= 0) return null;

  const judged = new Map(judgment.documents.map((document) => [document.documentId, document]));
  const everyday = rows.filter(
    (row) => row.date < today && (row.documentId == null || !judged.has(row.documentId))
  );

  const spentByKey = new Map<string, string>();
  let spent = "0";
  const periodDocuments = new Map<string, JudgedDocument>();
  for (const row of rows) {
    if (row.date < period.from || row.date > today) continue;
    const key = categoryKeyOf(row.categoryId);
    spentByKey.set(key, add(spentByKey.get(key) ?? "0", row.amount));
    spent = add(spent, row.amount);
    const document = row.documentId == null ? undefined : judged.get(row.documentId);
    if (document != null) periodDocuments.set(document.documentId, document);
  }

  const levels = new Map(judgment.categories.map((category) => [category.key, category]));
  const expected = judgment.expected.filter((item) => item.date > today);
  const inPeriod = expected.filter((item) => item.date <= period.end);
  const expectedByKey = new Map<string, number>();
  for (const item of inPeriod) {
    expectedByKey.set(item.key, (expectedByKey.get(item.key) ?? 0) + item.amount);
  }

  const phases = summarizePhases(judgment, everyday, today);
  const current = phases.at(-1) ?? null;

  const categories: JudgedCategoryForecast[] = [];
  for (const key of new Set([...spentByKey.keys(), ...levels.keys(), ...expectedByKey.keys()])) {
    const categorySpent = spentByKey.get(key) ?? "0";
    const base = Number(categorySpent) + (expectedByKey.get(key) ?? 0);
    const level = levels.get(key);
    const forecast =
      level == null
        ? { p10: base, p50: base, p90: base }
        : {
            p10: base + level.low * remaining,
            p50: base + level.mid * remaining,
            p90: base + level.high * remaining,
          };
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
      trend: categoryTrend(everyday, key, current, today),
    });
  }
  categories.sort((a, b) => b.forecast.p50 - a.forecast.p50 || a.key.localeCompare(b.key));

  const spentNumber = Number(spent);
  const running: Quantiles[] = [];
  for (let day = 1; day <= remaining; day++) {
    const date = addCivilDays(today, day);
    const due = inPeriod.reduce((sum, item) => sum + (item.date <= date ? item.amount : 0), 0);
    running.push(spread(judgment, day, spentNumber + due));
  }

  return {
    spent,
    total: running[remaining - 1]!,
    running,
    categories,
    phases,
    documents: [...periodDocuments.values()],
  };
}

/** Where the running total stands `days` days on: the middle day's sum, with the categories' spreads added as independent ones. */
function spread(judgment: Judgment, days: number, base: number): Quantiles {
  let middle = base;
  let lowSquares = 0;
  let highSquares = 0;
  for (const level of judgment.categories) {
    middle += level.mid * days;
    lowSquares += ((level.mid - level.low) * days) ** 2;
    highSquares += ((level.high - level.mid) * days) ** 2;
  }
  return {
    p10: Math.max(base, middle - Math.sqrt(lowSquares)),
    p50: middle,
    p90: middle + Math.sqrt(highSquares),
  };
}

/** The phases with their days and everyday spending a day, the current one running to yesterday. */
function summarizePhases(
  judgment: Judgment,
  everyday: readonly HistoryRow[],
  today: string
): JudgedPhaseSummary[] {
  const yesterday = addCivilDays(today, -1);
  return judgment.phases.map((phase, index) => {
    const next = judgment.phases[index + 1];
    const to = next == null ? yesterday : addCivilDays(next.from, -1);
    const days = civilDaysBetween(phase.from, to) + 1;
    let total = 0;
    for (const row of everyday) {
      if (row.date >= phase.from && row.date <= to) total += Number(row.amount);
    }
    return { from: phase.from, to, label: phase.label, daily: days > 0 ? total / days : null };
  });
}

/**
 * The last two weeks of a category's everyday spending against the current
 * phase's usual day. The direction is read from the same figure as the
 * percentage, so the arrow and the number shown beside it always agree.
 */
function categoryTrend(
  everyday: readonly HistoryRow[],
  key: string,
  phase: JudgedPhaseSummary | null,
  today: string
): CategoryTrend | null {
  if (phase == null) return null;
  const phaseDays = civilDaysBetween(phase.from, today);
  if (phaseDays < TREND_MIN_PHASE_DAYS) return null;
  const recentFrom = addCivilDays(today, -TREND_DAYS);
  let phaseTotal = 0;
  let recentTotal = 0;
  for (const row of everyday) {
    if (row.date < phase.from || categoryKeyOf(row.categoryId) !== key) continue;
    phaseTotal += Number(row.amount);
    if (row.date >= recentFrom) recentTotal += Number(row.amount);
  }
  if (phaseTotal <= 0) return null;
  const change = recentTotal / TREND_DAYS / (phaseTotal / phaseDays) - 1;
  const direction =
    change >= TREND_STEADY_SHARE ? "rising" : change <= -TREND_STEADY_SHARE ? "falling" : "steady";
  return { direction, change };
}

/** What the judgment of `asOf` expected the `days` days after it to cost: every category's middle day, and what was expected in them. */
export function judgedSpendingAhead(judgment: Judgment, asOf: string, days: number): number {
  const end = addCivilDays(asOf, days);
  let total = 0;
  for (const level of judgment.categories) total += level.mid * days;
  for (const item of judgment.expected) {
    if (item.date > asOf && item.date <= end) total += item.amount;
  }
  return total;
}
