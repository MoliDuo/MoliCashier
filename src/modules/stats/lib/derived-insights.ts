import { abs, add, compare, multiply } from "@/lib/money/decimal";
import { civilDaysBetween } from "@/modules/ledger/domain/period";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { generateHeatmapDateKeys } from "./heatmap-range";

/**
 * A category has to move by this much of the period's spending before it is
 * worth calling out. Growth from a previous total of zero is reported as
 * +100% no matter how small, so a ¥3 category would otherwise win the headline
 * every time. A share of the total rather than a fixed sum keeps the threshold
 * meaningful in every currency.
 */
const TOP_MOVER_MINIMUM_SHARE = "0.05";

/**
 * A forecast from one or two days is a guess at what the rest of the period
 * looks like from its first coffee; it waits for a few days to go on.
 */
const FORECAST_MINIMUM_DAYS = 3;

export interface StatsInsights {
  entryCount: number;
  /**
   * What a day in the period usually costs: the middle of its daily totals,
   * days with nothing recorded counted as nothing. Unlike the average, one rent
   * payment does not move it.
   */
  typicalDaily: string;
  /**
   * Where a running period is heading: what has been spent, plus a typical day
   * for every day still to come. Null for a period that is over, or too young
   * to say.
   */
  forecast: string | null;
  /** Null only when the window holds no days at all; a period that nets out negative still has a biggest day. */
  busiestDay: { date: string; total: string } | null;
  topMover: {
    id: string | null;
    name: string;
    amountDelta: string;
    direction: "up" | "down";
  } | null;
}

/** The middle value; the mean of the two middle ones for an even count. */
function median(values: string[]): string {
  if (values.length === 0) return "0";
  const sorted = values.toSorted(compare);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : multiply(add(sorted[middle - 1]!, sorted[middle]!), "0.5");
}

/**
 * Figures the statistics read already contains but does not spell out. Every
 * one of them is derived from the payload that is on screen, so they cannot
 * disagree with the charts and the ranking beside them.
 */
export function deriveStatsInsights(stats: EnhancedStatsDto): StatsInsights {
  const dateKeys = generateHeatmapDateKeys({
    startDate: stats.range.from,
    endDate: stats.range.to,
  });
  // The day map is keyed on the entry date, and a row whose date is missing
  // reaches the categories but not the days. Counting entries through the
  // categories is the only place that sees all of them.
  const entryCount = stats.categories.reduce((sum, category) => sum + category.count, 0);

  const totalByDate = new Map(stats.chart.map((point) => [point.date, point.total]));
  const typicalDaily = median(dateKeys.map((date) => totalByDate.get(date) ?? "0"));

  const remainingDays = civilDaysBetween(stats.range.to, stats.periodEnd);
  const forecast =
    stats.summary.comparison.mode === "same_period" &&
    remainingDays > 0 &&
    dateKeys.length >= FORECAST_MINIMUM_DAYS
      ? add(stats.summary.total, multiply(typicalDaily, String(remainingDays)))
      : null;

  const busiestDay = stats.chart.reduce<{ date: string; total: string } | null>(
    (best, point) => (best == null || compare(point.total, best.total) > 0 ? point : best),
    null
  );

  return {
    entryCount,
    typicalDaily,
    forecast,
    busiestDay,
    topMover: pickTopMover(stats),
  };
}

function pickTopMover(stats: EnhancedStatsDto): StatsInsights["topMover"] {
  // With nothing to compare against, every category has "grown by 100%" and
  // the comparison means nothing.
  if (compare(stats.summary.comparison.previousTotal, "0") === 0) return null;

  const threshold = multiply(abs(stats.summary.total), TOP_MOVER_MINIMUM_SHARE);
  // A category that went to nothing this period has fallen by all it was.
  const movers = [
    ...stats.categories.map((category) => ({
      id: category.id,
      name: category.name,
      delta: category.trend.amount,
    })),
    ...stats.previousOnlyCategories.map((category) => ({
      id: category.id,
      name: category.name,
      delta: multiply(category.previousTotal, "-1"),
    })),
  ];
  const leader = movers.reduce<(typeof movers)[number] | null>(
    (best, mover) =>
      best == null || compare(abs(mover.delta), abs(best.delta)) > 0 ? mover : best,
    null
  );
  if (leader == null) return null;

  const delta = leader.delta;
  if (compare(abs(delta), threshold) < 0) return null;
  return {
    id: leader.id,
    name: leader.name,
    amountDelta: abs(delta),
    direction: compare(delta, "0") > 0 ? "up" : "down",
  };
}
