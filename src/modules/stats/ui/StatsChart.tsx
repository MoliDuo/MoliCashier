"use client";
import { useMemo, useState } from "react";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { useLedgerTimeZone } from "@/components/providers/ledger-time-zone";
import { type DateRangeType, formatRelativeDateLabel } from "@/lib/date-utils";
import { formatCompactCurrencyAmount, formatCurrencyAmount } from "@/lib/format/currency";
import { buildChartPoints } from "@/modules/stats/lib/chart-points";
import { niceScale } from "@/modules/stats/lib/chart-scale";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsChartCopy, statsTabCopy } from "@/copy/stats";

interface StatsChartProps {
  data: { date: string; total: string }[];
  /** The days charted, one bar each (one a month on the year scale). */
  range: { from: string; to: string };
  /** The comparison period's daily totals; read against `data` by position. */
  previousData?: { date: string; total: string }[];
  /** The comparison period's compared days; null when there is nothing to compare. */
  previousRange?: { from: string; to: string } | null;
  dailyAverage?: string;
  rangeType: DateRangeType;
  currencySymbol?: string;
}

/** The plot's height; the axis labels sit in the padding around it. */
const PLOT_HEIGHT = 140;

/**
 * Each day's spending as a column, with the same day of the comparison period
 * as a dashed step behind it. Spending comes in separate amounts on separate
 * days, which columns say plainly; a line through them implied a slope between
 * days that was never there.
 */
export function StatsChart({
  data,
  range,
  previousData = [],
  previousRange = null,
  dailyAverage = "0",
  rangeType,
  currencySymbol = "CNY",
}: StatsChartProps) {
  const locale = DISPLAY_LOCALE;
  const timeZone = useLedgerTimeZone();
  const points = useMemo(
    () => buildChartPoints({ data, rangeType, startDate: range.from, endDate: range.to, locale }),
    [data, locale, range.from, range.to, rangeType]
  );
  // The comparison period covers other dates, so it is lined up by position —
  // its first day under this period's first day, counted from the day it
  // starts rather than its first record — and cut where this period ends.
  const previousValues = useMemo(() => {
    if (previousRange == null) return [];
    return buildChartPoints({
      data: previousData,
      rangeType,
      startDate: previousRange.from,
      endDate: previousRange.to,
      locale,
    })
      .slice(0, points.length)
      .map((point) => point.value);
  }, [locale, points.length, previousData, previousRange, rangeType]);
  const [active, setActive] = useState<number | null>(null);

  // A few outlying days — rent, a deposit — would flatten every other column
  // against the floor, so past the 90th percentile the scale is capped and the
  // tall ones marked. Two such days in each of two months are still under a
  // twentieth of the columns, which a 95th percentile would let through.
  const { scale, capped } = useMemo(() => {
    const values = [...points.map((point) => point.value), ...previousValues];
    const maxValue = Math.max(0, ...values);
    const sorted = values.toSorted((left, right) => left - right);
    const p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? maxValue;
    const cap = values.length >= 10 && maxValue - p90 >= maxValue * 0.2;
    return {
      scale: niceScale(cap ? Math.max(p90, maxValue * 0.2) : maxValue),
      capped: cap,
    };
  }, [points, previousValues]);

  if (points.length === 0) {
    return (
      <div
        className={textRoleClassName(
          "bodyMuted",
          "rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center"
        )}
      >
        {statsChartCopy.noData}
      </div>
    );
  }

  const minValue = Math.min(0, ...points.map((point) => point.value));
  const span = scale.max - minValue;
  /** Distance from the top of the plot, as a percentage of its height. */
  const top = (value: number) =>
    ((scale.max - Math.max(minValue, Math.min(value, scale.max))) / span) * 100;
  const zero = top(0);
  const money = (value: string) => formatCurrencyAmount(value, currencySymbol, locale);
  const average = Number(dailyAverage);
  const averageTop =
    rangeType !== "year" && Number.isFinite(average) && average > 0 && average < scale.max
      ? top(average)
      : null;
  const count = points.length;
  // At most twelve month labels at any width; the year view steps by one.
  const yearLabelStep = Math.max(1, Math.ceil(count / 12));
  const label = (fullDate: string) =>
    rangeType === "year" ? fullDate : formatRelativeDateLabel(fullDate, locale, timeZone);

  return (
    <div className="relative w-full select-none pt-7">
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 pl-12">
        {previousValues.length > 0 ? (
          <ul className="flex items-center gap-3 text-micro text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-2 rounded-t-[2px] bg-primary" />
              {statsTabCopy.thisPeriod}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="w-4 border-t-[1.5px] border-dashed border-muted-foreground"
              />
              {statsTabCopy.previousSamePeriod}
            </li>
          </ul>
        ) : (
          <span />
        )}
        {capped ? (
          <span className="rounded-full bg-surface2/60 px-2 py-0.5 text-micro text-muted-foreground">
            {statsChartCopy.scaleAdjusted}
          </span>
        ) : null}
      </div>

      <div className="relative ml-12 mr-2" style={{ height: `${PLOT_HEIGHT}px` }}>
        {/* Hairline gridlines at round values; the axis reads the columns nobody labels. */}
        {scale.ticks.map((tick) => (
          <div
            key={tick}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: `${top(tick)}%` }}
          >
            <span className="absolute right-full -translate-y-1/2 pr-2 text-micro tabular-nums text-muted-foreground">
              {formatCompactCurrencyAmount(tick, currencySymbol, locale)}
            </span>
          </div>
        ))}

        {averageTop != null ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-primary/50"
            style={{ top: `${averageTop}%` }}
          >
            <span className="absolute -top-4 right-0 rounded bg-surface px-1 text-micro text-muted-foreground">
              {statsTabCopy.dailyAverageLine}
            </span>
          </div>
        ) : null}

        <div className="absolute inset-0 flex">
          {points.map((point, index) => {
            const previous = previousValues[index];
            const isCapped = point.value > scale.max;
            const valueTop = top(point.value);
            const barTop = Math.min(valueTop, zero);
            const barHeight = Math.abs(zero - valueTop);
            const isActive = active === index;
            const leftPercent = ((index + 0.5) / count) * 100;
            return (
              <div key={point.fullDate} className="relative h-full flex-1">
                <button
                  type="button"
                  aria-label={[
                    `${label(point.fullDate)}, ${statsChartCopy.expense}: ${money(point.total)}`,
                    previous == null
                      ? null
                      : `${statsTabCopy.previousSamePeriod}: ${money(String(previous))}`,
                  ]
                    .filter((part) => part != null)
                    .join(", ")}
                  aria-current={isActive ? "true" : undefined}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  // A tap fires pointer-enter first, so toggling here would close
                  // what the tap had just opened; a tap on another column moves it.
                  onClick={() => setActive(index)}
                  className={cn(
                    "absolute inset-0 rounded-sm transition-colors duration-[var(--motion-feedback)]",
                    isActive && "bg-surface2/70"
                  )}
                >
                  {barHeight > 0 ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-1/2 -translate-x-1/2 bg-primary",
                        point.value < 0 ? "rounded-b-[4px]" : "rounded-t-[4px]"
                      )}
                      style={{
                        top: `${barTop}%`,
                        height: `max(${barHeight}%, 1px)`,
                        width: "min(24px, 64%)",
                      }}
                    />
                  ) : null}
                  {isCapped ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-4 left-1/2 -translate-x-1/2 text-micro text-muted-foreground"
                    >
                      ↑
                    </span>
                  ) : null}
                  {previous != null ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-muted-foreground/70"
                      style={{ top: `${top(previous)}%` }}
                    />
                  ) : null}
                </button>

                {isActive ? (
                  <div
                    role="tooltip"
                    className={cn(
                      textRoleClassName(
                        "meta",
                        "pointer-events-none absolute z-tooltip mb-1 whitespace-nowrap rounded border bg-popover px-2 py-1.5 text-popover-foreground shadow-lg"
                      ),
                      // Centred over an end column it would hang past the card,
                      // where the page clips it; the ends open inward instead.
                      leftPercent < 25
                        ? "left-0"
                        : leftPercent > 75
                          ? "right-0"
                          : "left-1/2 -translate-x-1/2"
                    )}
                    // It sits just above the taller of the column and the step.
                    style={{
                      bottom: `${100 - Math.min(barTop, previous == null ? 100 : top(previous))}%`,
                    }}
                  >
                    <div className="font-medium text-text">{label(point.fullDate)}</div>
                    <div className="tabular-nums">
                      {statsTabCopy.thisPeriod} {money(point.total)}
                      {isCapped ? statsChartCopy.exceedsLimit : null}
                    </div>
                    {previous != null ? (
                      <div className="tabular-nums">
                        {statsTabCopy.previousSamePeriod} {money(String(previous))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative ml-12 mr-2 h-6">
        {points.map((point, index) => {
          let show = false;
          let wideOnly = false;
          if (rangeType === "week") show = true;
          else if (rangeType === "year") {
            // Twelve month labels touch on a phone, so it keeps every other one.
            show = index % yearLabelStep === 0;
            wideOnly = (index / yearLabelStep) % 2 === 1;
          } else show = index === 0 || index === count - 1 || index % 5 === 0;
          if (!show) return null;
          return (
            <div
              key={point.fullDate}
              className={cn(
                "absolute top-1 w-8 -translate-x-1/2 text-center text-micro text-muted-foreground",
                wideOnly && "hidden sm:block"
              )}
              style={{ left: `${((index + 0.5) / count) * 100}%` }}
            >
              {point.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
