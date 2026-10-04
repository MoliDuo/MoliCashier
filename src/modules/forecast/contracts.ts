/** A low, a middle and a high outcome, as decimal strings: four in five outcomes fall between `p10` and `p90`. */
export interface ForecastRangeDto {
  p10: string;
  p50: string;
  p90: string;
}

export interface ForecastCategoryDto {
  /** Null for entries without a category. */
  id: string | null;
  /** Null for entries without a category. */
  name: string | null;
  icon: string | null;
  spent: string;
  /** Where the whole period ends up for the category, spent days included. */
  forecast: ForecastRangeDto;
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
}
