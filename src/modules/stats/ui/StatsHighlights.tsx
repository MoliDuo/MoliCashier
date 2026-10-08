"use client";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { formatCivilDate } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { ForecastAnomalyDto } from "@/modules/forecast/contracts";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { forecastCopy, statsTabCopy } from "@/copy/stats";

interface StatsHighlightsProps {
  insights: StatsInsights;
  /** The days of a running period that cost a category far more than usual. */
  anomalies?: readonly ForecastAnomalyDto[];
  currencySymbol: string;
  periodLabel: string;
  onDateDrilldown?: (date: string) => void;
}

/**
 * The two sentences the heatmap and the ranking each half-answer: which day
 * cost the most, and which category moved.
 *
 * The biggest day earns its place because a single outlying day is what drags
 * the headline comparison to figures like -97.9%; naming it turns a number that
 * looks broken into one the reader can go and check. The unusual days the
 * forecast found say the same of a category: this day, this much, against what
 * a day usually costs it.
 */
export function StatsHighlights({
  insights,
  anomalies = [],
  currencySymbol,
  periodLabel,
  onDateDrilldown,
}: StatsHighlightsProps) {
  const locale = DISPLAY_LOCALE;
  const { busiestDay, topMover } = insights;

  if (busiestDay == null && topMover == null && anomalies.length === 0) return null;
  const wholeUnits = (amount: string) =>
    formatCurrencyAmount(amount, currencySymbol, locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  return (
    <StatsPanel title={statsTabCopy.highlights}>
      <dl className="space-y-3">
        {busiestDay != null ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className={textRoleClassName("bodyMuted")}>{statsTabCopy.busiestDay}</dt>
            <dd className="flex min-w-0 items-baseline gap-2">
              {onDateDrilldown == null ? (
                <span className={textRoleClassName("meta")}>
                  {formatCivilDate(busiestDay.date, locale, { month: "numeric", day: "numeric" })}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onDateDrilldown(busiestDay.date)}
                  className={textRoleClassName(
                    "meta",
                    "rounded underline underline-offset-2 hover:text-text"
                  )}
                >
                  {formatCivilDate(busiestDay.date, locale, { month: "numeric", day: "numeric" })}
                </button>
              )}
              <AmountText variant="summary">
                {formatCurrencyAmount(busiestDay.total, currencySymbol, locale)}
              </AmountText>
            </dd>
          </div>
        ) : null}
      </dl>

      {topMover != null ? (
        <p
          className={textRoleClassName(
            "bodyMuted",
            busiestDay != null ? "border-t border-border pt-3" : undefined
          )}
        >
          {/* Both keys are spelled out so the catalogue check can find them. */}
          {topMover.direction === "up"
            ? statsTabCopy.topMoverUp(moverValues(topMover, periodLabel, currencySymbol, locale))
            : statsTabCopy.topMoverDown(moverValues(topMover, periodLabel, currencySymbol, locale))}
        </p>
      ) : null}

      {anomalies.length > 0 ? (
        <div
          className={cn(
            "space-y-1",
            busiestDay != null || topMover != null ? "border-t border-border pt-3" : undefined
          )}
        >
          <p className={textRoleClassName("meta")}>{forecastCopy.anomalies}</p>
          <ul className="space-y-1">
            {anomalies.map((anomaly) => (
              <li
                key={`${anomaly.date}-${anomaly.id ?? ""}`}
                className={textRoleClassName("bodyMuted")}
              >
                {forecastCopy.anomaly({
                  date: formatCivilDate(anomaly.date, locale, { month: "numeric", day: "numeric" }),
                  category: anomaly.name ?? statsTabCopy.uncategorized,
                  amount: wholeUnits(anomaly.amount),
                  typical: wholeUnits(anomaly.typical),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </StatsPanel>
  );
}

function moverValues(
  mover: NonNullable<StatsInsights["topMover"]>,
  periodLabel: string,
  currencySymbol: string,
  locale: string
) {
  return {
    category: mover.name ?? statsTabCopy.uncategorized,
    period: periodLabel,
    // Whole units: the sentence is about the size of the change, not its cents.
    amount: formatCurrencyAmount(mover.amountDelta, currencySymbol, locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
  };
}
