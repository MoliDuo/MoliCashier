"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { fetchForecast } from "@/modules/forecast/queries";
import { fetchEnhancedStats } from "@/modules/stats/queries";
import { StatsContentView, type StatsScale } from "@/modules/stats/ui/StatsContentView";
import type { Ledger } from "@/modules/ledger/contracts";
import { civilDaysBetween, resolveComparison, type Period } from "@/modules/ledger/domain/period";
import { DISPLAY_LOCALE, QUERY } from "@/lib/constants";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { buildStatsQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import {
  readStatsView,
  writeStatsView,
  type StatsView,
} from "@/modules/workspace/stats-url-params";
import { readPeriodParams, writePeriodParams } from "@/modules/workspace/period-url-params";
import { pushLedgerUrl } from "@/modules/workspace/ledger-url-navigation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { PeriodBar } from "./PeriodBar";
import { ListControlsDrop } from "./ListControlsDrop";
import { formatPeriodLabel } from "../period-label";
import { statsTabCopy } from "@/copy/stats";

const STATS_QUERY_DEBOUNCE_MS = 250;

interface StatsTabProps {
  /** The book the charts are narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: Ledger;
  /** Today in the ledger's zone, which the period is counted from. */
  today: string;
  /** The ledger's zone, so the period pickers name days the ledger's way. */
  timeZone: string;
  onCategoryDrilldown?: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown?: (date: string) => void;
}

/** How finely a span of days is charted: by day up to a month, by month beyond. */
function scaleOf(range: { from: string; to: string }): StatsScale {
  const days = civilDaysBetween(range.from, range.to) + 1;
  return days <= 7 ? "week" : days <= 62 ? "month" : "year";
}

/** What the figures are set against, or null when there is nothing to compare. */
function comparisonLabelOf(period: Period): string | null {
  switch (period.range) {
    case "all":
      return null;
    case "custom":
      return statsTabCopy.previousSpan;
    case "week":
      return statsTabCopy.lastWeek;
    case "month":
      return statsTabCopy.lastMonth;
    case "year":
      return statsTabCopy.lastYear;
  }
}

export function StatsTab({
  bookId,
  ledger,
  today,
  timeZone,
  onCategoryDrilldown,
  onDateDrilldown,
}: StatsTabProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = useMemo(() => readPeriodParams(searchParams), [searchParams]);
  const chartView = readStatsView(searchParams);
  const setPeriod = useCallback(
    (next: Period) => pushLedgerUrl(pathname, writePeriodParams(searchParams, next), "stats"),
    [pathname, searchParams]
  );
  const setChartView = useCallback(
    (view: StatsView) => pushLedgerUrl(pathname, writeStatsView(searchParams, view), "stats"),
    [pathname, searchParams]
  );

  const statsDescriptor = useMemo(
    () =>
      buildStatsQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        period,
        mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
      }),
    [bookId, ledger?.settings.mainCurrency, period]
  );
  const queryDescriptor = useDebouncedValue(statsDescriptor, STATS_QUERY_DEBOUNCE_MS);
  // The debounce is for stepping through periods. A book switch is a deliberate
  // navigation, so it must not wait behind the previous book's request: the new
  // scope's descriptor is used at once, and its key is what stops the old
  // figures being shown meanwhile.
  const scopeDescriptor =
    queryDescriptor.input.bookId === statsDescriptor.input.bookId
      ? queryDescriptor
      : statsDescriptor;
  const statsQuery = useQuery({
    queryKey: scopeDescriptor.queryKey,
    queryFn: () => fetchEnhancedStats(scopeDescriptor.input),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  // Only a calendar period that is still running has anywhere left to head.
  const forecastPeriod = scopeDescriptor.input.period;
  const forecastQuery = useQuery({
    queryKey: scopeDescriptor.forecastQueryKey,
    queryFn: () => fetchForecast(scopeDescriptor.input),
    enabled:
      forecastPeriod.range !== "all" &&
      forecastPeriod.range !== "custom" &&
      forecastPeriod.offset === 0,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  // The last successful figures are kept while a refetch runs, but only for the
  // book they belong to: switching books must not show the previous book's
  // figures. The period travels with them, so the comparison label stays the
  // one the numbers were computed for; the days come back with the figures.
  const [lastResolved, setLastResolved] = useState<{
    stats: NonNullable<typeof statsQuery.data>;
    period: Period;
    scope: string | null;
  } | null>(null);
  const resolvedPeriod = scopeDescriptor.input.period;
  useEffect(() => {
    if (statsQuery.data === undefined) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLastResolved({ stats: statsQuery.data!, period: resolvedPeriod, scope: bookId ?? null });
    });
    return () => {
      active = false;
    };
  }, [bookId, resolvedPeriod, statsQuery.data]);
  const lastResolvedForScope = lastResolved?.scope === (bookId ?? null) ? lastResolved : null;
  const stats = statsQuery.data ?? lastResolvedForScope?.stats;
  const contentPeriod =
    statsQuery.data === undefined && lastResolvedForScope != null
      ? lastResolvedForScope.period
      : resolvedPeriod;
  // The figures carry the days they cover; before any arrive, the same
  // resolution the server makes names them.
  const range = stats?.range ?? resolveComparison(contentPeriod, today).range;
  // The forecast is shown only beside the figures it was made for: while the
  // period changes, the old figures stay up and the new forecast waits.
  const forecast =
    forecastQuery.data != null &&
    stats != null &&
    forecastQuery.data.asOf === stats.range.to &&
    forecastQuery.data.periodEnd === stats.periodEnd
      ? forecastQuery.data
      : null;
  // A phone prints the period and the total between the book and the gear, as
  // 账目 does; the period is 统计's own, so the two pages never move each other.
  const total =
    stats == null
      ? null
      : formatCurrencyAmount(stats.summary.total, stats.summary.currency, DISPLAY_LOCALE);

  return (
    <div className="space-y-4">
      <StatsContentView
        periodBar={
          <ListControlsDrop
            summary={{ total, period: formatPeriodLabel(period, today), filtered: false }}
            period={period}
            today={today}
            onPeriodChange={setPeriod}
            timeZone={timeZone}
            // Dropped down on a phone it needs a surface of its own and holds
            // only the picker; from md up it stays the bare bar it always was.
            className="max-md:rounded-lg max-md:border max-md:border-border max-md:bg-surface max-md:p-2"
          >
            <PeriodBar
              className="max-md:hidden"
              period={period}
              today={today}
              onChange={setPeriod}
              timeZone={timeZone}
            />
          </ListControlsDrop>
        }
        range={range}
        scale={scaleOf(range)}
        comparisonLabel={comparisonLabelOf(contentPeriod)}
        stats={stats}
        forecast={forecast}
        isLoading={statsQuery.isFetching}
        isError={statsQuery.isError}
        onRetry={() => void statsQuery.refetch()}
        chartView={chartView}
        onChartViewChange={setChartView}
        fallbackCurrency={ledger?.settings.mainCurrency ?? "CNY"}
        {...(onCategoryDrilldown !== undefined ? { onCategoryDrilldown } : {})}
        {...(onDateDrilldown !== undefined ? { onDateDrilldown } : {})}
      />
    </div>
  );
}
