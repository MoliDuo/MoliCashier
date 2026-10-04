"use client";
import { textRoleClassName } from "@/components/typography";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { ForecastRangeDto } from "@/modules/forecast/contracts";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsTabCopy } from "@/copy/stats";

interface StatsMetricStripProps {
  insights: StatsInsights;
  /** The simulated forecast; when present it replaces the typical-day projection in `insights`. */
  forecast?: ForecastRangeDto | null;
  dailyAverage: string;
  currencySymbol: string;
}

/**
 * The figures that put the headline total in proportion: a day on average and
 * a day as it usually goes — a rent payment pulls the first and not the second
 * — how many entries it took, and, while the period runs, where it is heading.
 */
export function StatsMetricStrip({
  insights,
  forecast = null,
  dailyAverage,
  currencySymbol,
}: StatsMetricStripProps) {
  const locale = DISPLAY_LOCALE;
  const money = (amount: string) => formatCurrencyAmount(amount, currencySymbol, locale);

  const metrics: { label: string; hint?: string; value: React.ReactNode }[] = [
    {
      label: statsTabCopy.averageDaily,
      value: <AmountText variant="summary">{money(dailyAverage)}</AmountText>,
    },
    {
      label: statsTabCopy.typicalDaily,
      hint: statsTabCopy.typicalDailyHint,
      value: <AmountText variant="summary">{money(insights.typicalDaily)}</AmountText>,
    },
    {
      label: statsTabCopy.entries,
      value: <AmountText variant="summary">{insights.entryCount}</AmountText>,
    },
    ...(forecast != null
      ? [
          {
            label: statsTabCopy.forecast,
            hint: statsTabCopy.forecastModelHint({
              low: money(forecast.p10),
              high: money(forecast.p90),
            }),
            value: <AmountText variant="summary">{money(forecast.p50)}</AmountText>,
          },
        ]
      : insights.forecast == null
        ? []
        : [
            {
              label: statsTabCopy.forecast,
              hint: statsTabCopy.forecastHint,
              value: <AmountText variant="summary">{money(insights.forecast)}</AmountText>,
            },
          ]),
  ];

  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-3",
        metrics.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
      )}
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 space-y-0.5">
          <dt className={textRoleClassName("meta")} title={metric.hint}>
            {metric.label}
          </dt>
          <dd className="min-w-0 truncate">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}
