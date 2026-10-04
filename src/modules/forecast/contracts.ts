/** A low, a middle and a high outcome, as decimal strings: four in five outcomes fall between `p10` and `p90`. */
export interface ForecastRangeDto {
  p10: string;
  p50: string;
  p90: string;
}

export interface ForecastCategoryDto extends ForecastCategoryRef {
  spent: string;
  /** Where the whole period ends up for the category, spent days included. */
  forecast: ForecastRangeDto;
  /**
   * Which way the AI judged the category's everyday spending heading against
   * the current phase of life, and the last two weeks against the phase's
   * usual day as a share (0.25 reads "+25%"; null while the phase is short).
   * Null without a judgment.
   */
  trend: { direction: "rising" | "falling" | "steady"; change: number | null } | null;
}

/** Who a recurring bill, an unusual day and a category row belong to. */
interface ForecastCategoryRef {
  /** Null for entries without a category. */
  id: string | null;
  name: string | null;
  icon: string | null;
}

/** A stretch of life as the AI split the ledger. */
export interface ForecastPhaseDto {
  from: string;
  /** Its last day; yesterday for the current one. */
  to: string;
  label: string;
  /** Everyday spending a day across it, purchases judged not everyday left out; null for one begun today. */
  daily: string | null;
}

/** What the AI analyst judged, and how its past judgments did. */
export interface ForecastJudgmentDto {
  /** The day it judged. */
  asOf: string;
  phases: ForecastPhaseDto[];
  /** The purchases of the period so far it judged not everyday. */
  documents: {
    documentId: string;
    kind: "one_off" | "recurring";
    cadence: "weekly" | "monthly" | "semester" | "yearly" | "irregular" | null;
  }[];
  /** Null until past judgments have been scored. */
  accuracy: {
    origins: number;
    horizonDays: number;
    /** The typical miss as a share of what was spent: 0.11 reads "±11%". */
    error: number;
    statisticalError: number;
  } | null;
}

/** A day of the period that cost a category far more than its usual day. */
export interface ForecastAnomalyDto extends ForecastCategoryRef {
  date: string;
  amount: string;
  /** What a day with spending in the category usually costs. */
  typical: string;
}

/** How the forecast was chosen, and how well that choice did on days already past. */
export interface ForecastModelDto {
  /** The day the models were trained for. */
  trainedFor: string;
  /** The share of the simulated paths the network plays; 0 when it did not beat the statistical model. */
  networkShare: number;
  /** Null with too little history to test on. */
  accuracy: {
    /** How many past days were stood on, and how many days each forecast. */
    origins: number;
    horizonDays: number;
    /** The middle outcome's typical miss as a share of what was spent: 0.11 reads "±11%". */
    error: number;
    statisticalError: number;
    networkError: number | null;
    /** The old rule — a typical day times the days left — as the bar to clear. */
    typicalDayError: number;
  } | null;
}

/**
 * Where a running period is heading, as 统计 shows it. Only a calendar period
 * that is still running has one; for any other the read returns null.
 */
export interface ForecastDto {
  /** Today: the last day counted as spent. */
  asOf: string;
  /** The period's own last day. */
  periodEnd: string;
  currency: string;
  /** The first day the forecast learnt from. */
  historyFrom: string;
  /** How fast the past faded: a day this many days old counted half; null when every day counted the same. */
  halfLifeDays: number | null;
  spent: string;
  /** Where the whole period ends up, spent days included. */
  total: ForecastRangeDto;
  /** The period's running total at the end of each day from tomorrow through `periodEnd`. */
  running: ForecastRangeDto[];
  /** The largest expected first. */
  categories: ForecastCategoryDto[];
  /** The previous period's whole total, and how likely this one ends above it; null with nothing to compare. */
  exceedPrevious: { total: string; probability: number } | null;
  /**
   * The day the current way of spending began, with the average spending a
   * day over the four weeks before it and since; null when the history shows
   * no change. Days before it counted for less.
   */
  lifeChange: { date: string; dailyBefore: string; dailyAfter: string } | null;
  /**
   * A single purchase of at least this much counts as a large one-off: it is
   * left out of the days ahead and counts only once recorded. Null with no
   * history to read it from.
   */
  largePurchaseFrom: string | null;
  /** The days so far that cost a category far more than usual, the most unusual first. */
  anomalies: ForecastAnomalyDto[];
  /** Null until the nightly training (or the first read's) has finished. */
  model: ForecastModelDto | null;
  /**
   * The AI analyst's judgment the figures were computed from; null when there
   * is none recent enough and the statistical model answered instead.
   */
  judgment: ForecastJudgmentDto | null;
}
