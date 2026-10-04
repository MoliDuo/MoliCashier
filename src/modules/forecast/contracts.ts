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
   * What the rest of the period costs in the category on a sample of the
   * simulated paths, the same paths in every category: the what-if scales a
   * category's and adds the paths back up.
   */
  samples: number[];
}

/** Who a recurring bill, an unusual day and a category row belong to. */
interface ForecastCategoryRef {
  /** Null for entries without a category. */
  id: string | null;
  name: string | null;
  icon: string | null;
}

/** A bill that has come back on a schedule and is expected again before the period ends. */
export interface ForecastUpcomingDto extends ForecastCategoryRef {
  date: string;
  label: string;
  amount: string;
  cadence: "weekly" | "biweekly" | "monthly";
  /** How many came in a row on schedule. */
  streak: number;
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
  /** The recurring bills expected after today through `periodEnd`, soonest first. */
  upcoming: ForecastUpcomingDto[];
  /** The days so far that cost a category far more than usual, the most unusual first. */
  anomalies: ForecastAnomalyDto[];
  /** Null until the nightly training (or the first read's) has finished. */
  model: ForecastModelDto | null;
}

/** The model's few sentences on a forecast, for the day they were written. */
export interface ForecastCommentaryDto {
  asOf: string;
  sentences: string[];
}
