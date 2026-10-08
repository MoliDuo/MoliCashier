import { addCivilDays } from "@/modules/ledger/domain/period";
import { forecastPeriod, type ForecastOptions } from "../forecast";
import type { HistoryRow } from "../series";
import { judgedSpendingAhead } from "./apply";
import { isCurrentJudgmentVersion } from "./fingerprint";
import type { Judgment } from "./schema";

/** How the AI's past judgments did, and the statistical model on the same days. */
export interface JudgmentAccuracy {
  /** How many past days were scored, and how many days ahead each. */
  origins: number;
  horizonDays: number;
  /** The typical miss as a share of what was spent: 0.11 reads "±11%". */
  error: number;
  statisticalError: number;
}

/** The most past judgments scored; the most recent ones. */
const MAX_ORIGINS = 60;

/** One past day, scored: what it cost, and what each side expected. */
export interface JudgmentScore {
  actual: number;
  judged: number;
  statistical: number;
}

/**
 * The past judgments to score: those made under the current prompt whose next
 * `horizon` days are over, the most recent first. A judgment made the old way
 * says nothing about how the analyst judges now.
 */
export function scorableJudgments<T extends { asOf: string; inputFingerprint: string }>(
  judgments: readonly T[],
  today: string,
  horizon: number
): T[] {
  return judgments
    .filter(
      (item) =>
        isCurrentJudgmentVersion(item.inputFingerprint) && addCivilDays(item.asOf, horizon) < today
    )
    .sort((a, b) => b.asOf.localeCompare(a.asOf))
    .slice(0, MAX_ORIGINS);
}

/**
 * Scores one past judgment: what it expected the `horizon` days after it to
 * cost against what they did cost, purchases judged one-off included, since
 * money spent is money spent. The statistical model forecasts the same days
 * from the same history, cut at the same day, so the two are compared on
 * equal terms.
 */
export function scoreJudgment(input: {
  asOf: string;
  judgment: Judgment;
  rows: readonly HistoryRow[];
  horizon: number;
  statistical: Omit<ForecastOptions, "network" | "networkShare">;
}): JudgmentScore {
  const { asOf, rows, horizon } = input;
  const end = addCivilDays(asOf, horizon);
  let actual = 0;
  for (const row of rows) {
    if (row.date > asOf && row.date <= end) actual += Number(row.amount);
  }
  return {
    actual,
    judged: judgedSpendingAhead(input.judgment, asOf, horizon),
    // With too little history for the model, its fallback is to expect nothing.
    statistical: statisticalAhead(rows, asOf, end, input.statistical) ?? 0,
  };
}

/** The scores together, each side's typical miss as a share of what was spent; null with nothing scored or spent. */
export function summarizeScores(
  scores: readonly JudgmentScore[],
  horizon: number
): JudgmentAccuracy | null {
  const actual = scores.reduce((sum, score) => sum + score.actual, 0);
  if (scores.length === 0 || actual <= 0) return null;
  const miss = (side: "judged" | "statistical") =>
    scores.reduce((sum, score) => sum + Math.abs(score[side] - score.actual), 0) / actual;
  return {
    origins: scores.length,
    horizonDays: horizon,
    error: miss("judged"),
    statisticalError: miss("statistical"),
  };
}

/** What the statistical model, standing on `asOf` with only what was known by then, expected the days after it through `end` to cost. */
function statisticalAhead(
  rows: readonly HistoryRow[],
  asOf: string,
  end: string,
  options: Omit<ForecastOptions, "network" | "networkShare">
): number | null {
  const forecast = forecastPeriod({
    rows: rows.filter((row) => row.date <= asOf),
    today: asOf,
    period: { from: asOf, end },
    previous: null,
    options: { ...options, network: null, networkShare: 0 },
  });
  return forecast == null ? null : forecast.total.p50 - Number(forecast.spent);
}
