"use client";
import { textRoleClassName } from "@/components/typography";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { abs, compare } from "@/lib/money/decimal";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { StatsMetricStrip } from "./StatsMetricStrip";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsTabCopy } from "@/copy/stats";

interface StatsSummaryProps {
  total: string;
  dailyAverage: string;
  currencySymbol: string;
  comparison: EnhancedStatsDto["summary"]["comparison"] | undefined;
  periodLabel: string;
  insights: StatsInsights;
  isLoading?: boolean;
}

export function StatsSummary({
  total,
  dailyAverage,
  currencySymbol,
  comparison,
  periodLabel,
  insights,
  isLoading = false,
}: StatsSummaryProps) {
  const locale = DISPLAY_LOCALE;

  const delta = comparison?.amountDelta ?? "0";
  const deltaComparison = compare(delta, "0");
  const isIncrease = deltaComparison > 0;
  const isDecrease = deltaComparison < 0;
  const comparisonValues = {
    period: periodLabel,
    amount: formatCurrencyAmount(abs(delta), currencySymbol, locale),
    percent: Math.abs(comparison?.percent ?? 0).toFixed(1),
  };
  const comparisonText =
    comparison == null
      ? null
      : comparison.mode === "same_period"
        ? deltaComparison === 0
          ? statsTabCopy.samePeriodEqual(comparisonValues)
          : isIncrease
            ? statsTabCopy.samePeriodMore(comparisonValues)
            : statsTabCopy.samePeriodLess(comparisonValues)
        : deltaComparison === 0
          ? statsTabCopy.fullPeriodEqual(comparisonValues)
          : isIncrease
            ? statsTabCopy.fullPeriodMore(comparisonValues)
            : statsTabCopy.fullPeriodLess(comparisonValues);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="min-w-0 space-y-1">
          <p className={textRoleClassName("bodyMuted")}>{statsTabCopy.totalExpense}</p>
          {isLoading ? (
            <div className="h-10 w-36 animate-pulse rounded bg-surface2" aria-hidden />
          ) : (
            <AmountText variant="hero">
              {formatCurrencyAmount(total, currencySymbol, locale)}
            </AmountText>
          )}
          {!isLoading && comparisonText != null ? (
            <p
              className={cn(
                textRoleClassName("meta", "w-fit max-w-full rounded-md px-2 py-0.5 font-medium"),
                isIncrease
                  ? "bg-destructive/10 text-destructive"
                  : isDecrease
                    ? "bg-primary/10 text-primary"
                    : "bg-surface2 text-muted-foreground"
              )}
            >
              {comparisonText}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 sm:max-w-md sm:flex-1">
          {isLoading ? (
            <div className="h-12 animate-pulse rounded bg-surface2" aria-hidden />
          ) : (
            <StatsMetricStrip
              insights={insights}
              dailyAverage={dailyAverage}
              currencySymbol={currencySymbol}
            />
          )}
        </div>
      </div>
    </section>
  );
}
