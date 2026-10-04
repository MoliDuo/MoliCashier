"use client";

import { useMemo, type ReactNode } from "react";
import { BarChart3, Grid3X3, TrendingUp } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import type { DateRangeType } from "@/lib/date-utils";
import { openLedgerEntrySourceDocument } from "@/lib/navigation/ledger-detail-navigation";
import type { ForecastDto } from "@/modules/forecast/contracts";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import { deriveStatsInsights, type StatsInsights } from "@/modules/stats/lib/derived-insights";
import { CalendarHeatmapSection } from "./CalendarHeatmapSection";
import { StatsCategoryForecast } from "./StatsCategoryForecast";
import { StatsChart } from "./StatsChart";
import { StatsCumulativeChart } from "./StatsCumulativeChart";
import { StatsHighlights } from "./StatsHighlights";
import { StatsLargestEntries } from "./StatsLargestEntries";
import { StatsPanel } from "./StatsPanel";
import { StatsRanking } from "./StatsRanking";
import { StatsSummary } from "./StatsSummary";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { IncompleteConversionNotice } from "@/components/IncompleteConversionNotice";
import { statsTabCopy } from "@/copy/stats";

/** How finely the charts read the days: by day for a week or a month, by month beyond. */
export type StatsScale = DateRangeType;

/** The daily columns, the running total, or the calendar. */
type StatsChartView = "trend" | "cumulative" | "heatmap";

const CHART_VIEWS: { view: StatsChartView; label: string; icon: typeof BarChart3 }[] = [
  { view: "trend", label: statsTabCopy.daily, icon: BarChart3 },
  { view: "cumulative", label: statsTabCopy.cumulative, icon: TrendingUp },
  { view: "heatmap", label: statsTabCopy.heatmap, icon: Grid3X3 },
];

const CHART_TITLES: Record<StatsChartView, string> = {
  trend: statsTabCopy.expenseTrend,
  cumulative: statsTabCopy.cumulativeExpense,
  heatmap: statsTabCopy.dailyHeatmap,
};

const NO_INSIGHTS: StatsInsights = {
  entryCount: 0,
  typicalDaily: "0",
  forecast: null,
  busiestDay: null,
  topMover: null,
};

interface StatsContentViewProps {
  /** The period control, owned by the route that owns the URL. */
  periodBar: ReactNode;
  /** The days the figures cover. */
  range: { from: string; to: string };
  scale: StatsScale;
  /** What the figures are set against, e.g. 上月; null hides the comparison. */
  comparisonLabel: string | null;
  stats: EnhancedStatsDto | undefined;
  /**
   * The simulated forecast for the same figures, when the period is running
   * and it has arrived. Without it the summary and the running total fall back
   * to the typical-day projection the figures carry.
   */
  forecast?: ForecastDto | null;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  chartView: StatsChartView;
  onChartViewChange: (view: StatsChartView) => void;
  fallbackCurrency?: string;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
}

export function StatsContentView({
  periodBar,
  range,
  scale,
  comparisonLabel,
  stats,
  forecast = null,
  isLoading = false,
  isError = false,
  onRetry,
  chartView,
  onChartViewChange,
  fallbackCurrency = "CNY",
  onCategoryDrilldown,
  onDateDrilldown,
}: StatsContentViewProps) {
  const locale = DISPLAY_LOCALE;
  const currencySymbol = stats?.summary.currency ?? fallbackCurrency;
  const periodLabel = comparisonLabel ?? "";
  const startDateStr = range.from;
  const endDateStr = range.to;

  // Derived once here rather than in each panel: they are all reading the same
  // payload, and several copies of the walk would be several chances to disagree.
  const insights = useMemo(
    () =>
      stats == null ? null : withoutComparison(deriveStatsInsights(stats), comparisonLabel == null),
    [comparisonLabel, stats]
  );

  if (isError && stats == null) {
    return (
      <div className="space-y-6">
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-8 text-center"
        >
          <p className={textRoleClassName("body")}>{statsTabCopy.loadFailed}</p>
          {onRetry != null ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {statsTabCopy.retry}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const viewSwitch = (
    <div role="group" aria-label={statsTabCopy.chartViews} className="flex items-center gap-1">
      {CHART_VIEWS.map(({ view, label, icon: Icon }) => (
        <Button
          key={view}
          variant={chartView === view ? "default" : "ghost"}
          size="sm"
          onClick={() => onChartViewChange(view)}
          aria-pressed={chartView === view}
          className="h-9 px-2.5 sm:h-7 sm:px-2"
        >
          <Icon aria-hidden="true" className="mr-1 h-4 w-4" />
          {label}
        </Button>
      ))}
    </div>
  );

  const comparison = stats?.summary.comparison;

  return (
    <div className="relative space-y-6" aria-busy={isLoading}>
      {isError ? (
        <div
          role="alert"
          className={textRoleClassName(
            "body",
            "flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2"
          )}
        >
          <span className="text-danger">{statsTabCopy.loadFailed}</span>
          {onRetry != null ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {statsTabCopy.retry}
            </Button>
          ) : null}
        </div>
      ) : null}

      {periodBar}

      <StatsSummary
        total={stats?.summary.total ?? "0"}
        dailyAverage={stats?.summary.dailyAverage ?? "0"}
        currencySymbol={currencySymbol}
        comparison={comparisonLabel == null ? undefined : comparison}
        periodLabel={periodLabel}
        insights={insights ?? NO_INSIGHTS}
        forecast={forecast?.total ?? null}
        isLoading={isLoading && stats == null}
      />

      {stats?.unconvertedCount != null && stats.unconvertedCount > 0 ? (
        <IncompleteConversionNotice />
      ) : null}

      {/*
       * Two columns from lg. Below that the heatmap column would be narrower
       * than the phone layout it is already tuned for, which is the worst of
       * both; above it there is room for the ranking to sit beside the calendar
       * instead of below the fold.
       */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <div className="min-w-0 lg:col-span-7">
          <StatsPanel title={CHART_TITLES[chartView]} actions={viewSwitch}>
            {stats == null ? (
              <div
                className="h-64 animate-pulse rounded-lg border border-border bg-surface2/60"
                data-testid="stats-visualization-skeleton"
                role="status"
                aria-busy="true"
              />
            ) : chartView === "trend" ? (
              <StatsChart
                data={stats.chart}
                range={stats.range}
                previousData={stats.previousChart}
                previousRange={
                  comparisonLabel == null || comparison == null
                    ? null
                    : { from: comparison.from, to: comparison.to }
                }
                dailyAverage={stats.summary.dailyAverage}
                rangeType={scale}
                currencySymbol={currencySymbol}
              />
            ) : chartView === "cumulative" ? (
              <StatsCumulativeChart
                data={stats.chart}
                range={stats.range}
                periodEnd={stats.periodEnd}
                forecast={insights?.forecast ?? null}
                forecastBand={forecast?.running ?? null}
                previous={
                  comparisonLabel == null
                    ? null
                    : {
                        data: stats.previousChart,
                        from: stats.summary.comparison.from,
                        to: stats.summary.comparison.wholeTo,
                        total: stats.summary.comparison.previousWholeTotal,
                        label: comparisonLabel,
                      }
                }
                currencySymbol={currencySymbol}
              />
            ) : (
              <CalendarHeatmapSection
                days={stats.heatmap.days}
                stats={stats.heatmap.stats}
                {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
                currency={currencySymbol}
                locale={locale}
                queryRange={{ startDate: startDateStr, endDate: endDateStr }}
              />
            )}
          </StatsPanel>
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-5">
          <StatsRanking
            data={stats?.categories ?? []}
            isLoading={isLoading && stats == null}
            currencySymbol={currencySymbol}
            showChange={
              comparisonLabel != null &&
              comparison != null &&
              Number(comparison.previousTotal) !== 0
            }
            {...(onCategoryDrilldown !== undefined
              ? {
                  onCategoryClick: (categoryId: string) =>
                    onCategoryDrilldown(categoryId, startDateStr, endDateStr),
                }
              : {})}
          />

          {forecast != null ? (
            <StatsCategoryForecast
              forecast={forecast}
              currencySymbol={currencySymbol}
              periodLabel={comparisonLabel}
              {...(onCategoryDrilldown !== undefined
                ? {
                    onCategoryClick: (categoryId: string) =>
                      onCategoryDrilldown(categoryId, startDateStr, endDateStr),
                  }
                : {})}
            />
          ) : null}

          {stats != null ? (
            <StatsLargestEntries
              entries={stats.largestEntries}
              currencySymbol={currencySymbol}
              onOpen={openLedgerEntrySourceDocument}
            />
          ) : null}

          {insights != null ? (
            <StatsHighlights
              insights={insights}
              currencySymbol={currencySymbol}
              periodLabel={periodLabel}
              {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Without a comparison there is no "more than last time" to point out. */
function withoutComparison<T extends { topMover: unknown }>(insights: T, hide: boolean): T {
  return hide ? { ...insights, topMover: null } : insights;
}
