import type { CalendarDayData, CalendarHeatmapStats } from "@/types/calendar";

type EnhancedCategoryStatDto = {
  id: string | null;
  name: string;
  icon: string | null;
  totalConverted: string;
  currency: string;
  /**
   * Share of the period's positive spending, so a refunded category cannot
   * shrink the denominator and push the others above 100%. Categories whose
   * own net is zero or negative have no share of spending and report 0.
   */
  percent: number;
  count: number;
  trend: {
    /** Null when the category had nothing in the comparison period: growth from nothing has no percentage. */
    percent: number | null;
    amount: string;
  };
};

/** A category spent on in the comparison period and not at all in this one. */
type PreviousOnlyCategoryDto = {
  id: string | null;
  name: string;
  icon: string | null;
  /** What it came to in the comparison period; it has fallen by all of it. */
  previousTotal: string;
};

export type StatsComparisonMode = "same_period" | "full_period";

/** One of the period's biggest entries, as 统计 lists them. */
export interface StatsLargestEntryDto {
  id: string;
  sourceDocumentId: string;
  name: string;
  categoryName: string | null;
  categoryIcon: string | null;
  /** The record's date. */
  date: string;
  /** Converted to the main currency, which the list is ordered by. */
  amount: string;
  originalAmount: string;
  originalCurrency: string;
}

export interface EnhancedStatsDto {
  /** The days these figures cover, as the server resolved the period. */
  range: { from: string; to: string };
  /** The period's own last day: later than `range.to` while the period is still running. */
  periodEnd: string;
  unconvertedCount: number;
  summary: {
    total: string;
    currency: string;
    dailyAverage: string;
    comparison: {
      mode: StatsComparisonMode;
      from: string;
      to: string;
      previousTotal: string;
      amountDelta: string;
      /** Null when the comparison period came to nothing: growth from nothing has no percentage. */
      percent: number | null;
      /** The comparison period's own last day; past `to` when only its first days are compared. */
      wholeTo: string;
      /** What the comparison period came to in the end, `from` through `wholeTo`. */
      previousWholeTotal: string;
    };
  };
  categories: EnhancedCategoryStatDto[];
  /** The categories the comparison period spent on and this one did not, largest first. */
  previousOnlyCategories: PreviousOnlyCategoryDto[];
  chart: { date: string; total: string }[];
  /**
   * The comparison period's daily totals, `comparison.from` through
   * `comparison.wholeTo`, in the same shape as `chart`. The two windows cover
   * different dates, so a reader aligns them by position — day one against day
   * one — rather than by date.
   */
  previousChart: { date: string; total: string }[];
  /** The period's biggest entries by converted amount, largest first; at most five. */
  largestEntries: StatsLargestEntryDto[];
  heatmap: {
    days: CalendarDayData[];
    stats: CalendarHeatmapStats;
  };
}
