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
   * Which way the category's everyday spending is heading: the last two weeks
   * against the usual day of the current phase of life, as a share (0.25
   * reads "+25%"). Null without a judgment, or while the phase is too short
   * to have a usual day.
   */
  trend: { direction: "rising" | "falling" | "steady"; change: number } | null;
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

/** What the AI analyst judged. */
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
}

/** A day of the period that cost a category far more than its usual day. */
export interface ForecastAnomalyDto extends ForecastCategoryRef {
  date: string;
  amount: string;
  /** What a day with spending in the category usually costs. */
  typical: string;
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
  spent: string;
  /** Where the whole period ends up, spent days included. */
  total: ForecastRangeDto;
  /** The period's running total at the end of each day from tomorrow through `periodEnd`. */
  running: ForecastRangeDto[];
  /** The largest expected first. */
  categories: ForecastCategoryDto[];
  /**
   * The day the current way of spending began, with the average spending a
   * day over the four weeks before it and since; null when the history shows
   * no change. Days before it counted for less.
   */
  lifeChange: { date: string; dailyBefore: string; dailyAfter: string } | null;
  /** The days so far that cost a category far more than usual, the most unusual first. */
  anomalies: ForecastAnomalyDto[];
  /**
   * The AI analyst's judgment the figures were computed from; null when there
   * is none recent enough and the statistical model answered instead.
   */
  judgment: ForecastJudgmentDto | null;
}
