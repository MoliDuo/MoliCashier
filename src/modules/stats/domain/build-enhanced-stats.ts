import Decimal from "decimal.js";
import type { CalendarDayData, CalendarHeatmapStats } from "@/types/calendar";
import type {
  EnhancedStatsDto,
  StatsComparisonMode,
  StatsLargestEntryDto,
} from "@/modules/stats/contracts";

interface EnhancedStatsBucketCategory {
  id: string | null;
  /** Null for the entries without a category. */
  name: string | null;
  icon: string | null;
  total: Decimal;
  count: number;
}

interface EnhancedStatsBucketDay {
  total: Decimal;
  count: number;
  currencies: Set<string>;
}

export interface EnhancedStatsBucket {
  total: Decimal;
  categories: Map<string, EnhancedStatsBucketCategory>;
  days: Map<string, EnhancedStatsBucketDay>;
}

export interface BuildEnhancedStatsDtoInput {
  mainCurrency: string;
  unconvertedCount: number;
  current: EnhancedStatsBucket;
  /** The comparison period through `compareRange.to`, which the totals are set against. */
  previous: EnhancedStatsBucket;
  /** The comparison period through its own end, which the chart draws; `previous` when they coincide. */
  previousWhole?: EnhancedStatsBucket | undefined;
  queryRange: { from: string; to: string };
  compareRange: { from: string; to: string };
  comparisonMode?: StatsComparisonMode | undefined;
  periodEnd?: string | undefined;
  previousWholeTo?: string | undefined;
  largestEntries?: StatsLargestEntryDto[] | undefined;
}

function categoryKey(categoryId: string | null): string {
  return categoryId ?? "uncategorized";
}

/**
 * Decimal growth: the change, and the change as a share of the previous
 * total. Growth from nothing has no share — any amount would be an infinite
 * percentage — so it is null, and only the amount speaks.
 */
function calculateDecimalGrowth(
  current: Decimal,
  previous: Decimal
): { percent: number | null; amount: string } {
  const delta = current.minus(previous);
  if (previous.isZero()) {
    return { amount: delta.toFixed(), percent: null };
  }
  return { amount: delta.toFixed(), percent: delta.dividedBy(previous).times(100).toNumber() };
}

function calculateHeatmapStats(amounts: string[]): CalendarHeatmapStats {
  if (amounts.length === 0) {
    return { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" };
  }
  const sorted = [...amounts].toSorted((left, right) => new Decimal(left).cmp(right));
  const min = sorted[0] ?? "0";
  const max = sorted[sorted.length - 1] ?? min;
  const avg = amounts
    .reduce((sum, amount) => sum.plus(amount), new Decimal(0))
    .dividedBy(amounts.length)
    .toFixed();
  const p80Index = Math.max(0, Math.ceil(sorted.length * 0.8) - 1);
  return {
    minAmount: min,
    maxAmount: max,
    avgAmount: avg,
    p80Amount: sorted[p80Index] ?? max,
  };
}

/** Inclusive civil-day length of a YYYY-MM-DD range, without clock drift. */
function civilDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return end >= start ? Math.round((end - start) / 86_400_000) + 1 : 0;
}

/**
 * Shared assembly for enhanced stats DTOs. Every read that produces statistics
 * folds its rows into buckets and hands them here, so the figures cannot drift
 * apart between one reader and the next.
 */
export function buildEnhancedStatsDto({
  mainCurrency,
  unconvertedCount,
  current,
  previous,
  previousWhole = previous,
  queryRange,
  compareRange,
  comparisonMode,
  periodEnd = queryRange.to,
  previousWholeTo = compareRange.to,
  largestEntries = [],
}: BuildEnhancedStatsDtoInput): EnhancedStatsDto {
  const growth = calculateDecimalGrowth(current.total, previous.total);
  const dayCount = civilDayCount(queryRange.from, queryRange.to);
  const dailyAverage = dayCount > 0 ? current.total.dividedBy(dayCount).toFixed() : "0";

  // A refund nets against the period total, so a share measured against it can
  // exceed 100% for everyone else. Spending shares are measured against what was
  // actually spent, and a category that nets out to nothing has no share of it.
  const positiveTotal = [...current.categories.values()].reduce(
    (sum, category) => (category.total.gt(0) ? sum.plus(category.total) : sum),
    new Decimal(0)
  );

  const categories = [...current.categories.values()]
    .toSorted((left, right) => right.total.cmp(left.total))
    .map((category) => {
      const previousCategory = previous.categories.get(categoryKey(category.id));
      const categoryGrowth = calculateDecimalGrowth(
        category.total,
        previousCategory?.total ?? new Decimal(0)
      );
      return {
        id: category.id,
        name: category.name,
        icon: category.icon,
        totalConverted: category.total.toFixed(),
        currency: mainCurrency,
        percent:
          category.total.gt(0) && positiveTotal.gt(0)
            ? category.total.dividedBy(positiveTotal).times(100).toNumber()
            : 0,
        count: category.count,
        trend: {
          percent: categoryGrowth.percent,
          amount: categoryGrowth.amount,
        },
      };
    });

  // A category that went from something to nothing has moved as much as one that grew by as much.
  const previousOnlyCategories = [...previous.categories.entries()]
    .filter(([key, category]) => !current.categories.has(key) && !category.total.isZero())
    .toSorted(([, left], [, right]) => right.total.abs().cmp(left.total.abs()))
    .map(([, category]) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      previousTotal: category.total.toFixed(),
    }));

  const sortedDaysOf = (bucket: EnhancedStatsBucket) =>
    [...bucket.days.entries()].toSorted(([left], [right]) => left.localeCompare(right));
  const dailyTotals = (days: [string, EnhancedStatsBucketDay][]) =>
    days.map(([date, day]) => ({ date, total: day.total.toFixed() }));

  const sortedDays = sortedDaysOf(current);
  const chart = dailyTotals(sortedDays);
  const previousChart = dailyTotals(sortedDaysOf(previousWhole));
  const heatmapDays: CalendarDayData[] = sortedDays.map(([date, day]) => ({
    date,
    totalAmount: day.total.toFixed(),
    entryCount: day.count,
    currencies: [...day.currencies],
  }));

  return {
    range: { from: queryRange.from, to: queryRange.to },
    periodEnd,
    unconvertedCount,
    summary: {
      total: current.total.toFixed(),
      currency: mainCurrency,
      dailyAverage,
      comparison: {
        mode: comparisonMode ?? "same_period",
        from: compareRange.from,
        to: compareRange.to,
        previousTotal: previous.total.toFixed(),
        amountDelta: current.total.minus(previous.total).toFixed(),
        percent: growth.percent,
        wholeTo: previousWholeTo,
        previousWholeTotal: previousWhole.total.toFixed(),
      },
    },
    categories,
    previousOnlyCategories,
    chart,
    previousChart,
    largestEntries,
    heatmap: {
      days: heatmapDays,
      stats: calculateHeatmapStats(heatmapDays.map((day) => day.totalAmount)),
    },
  };
}
