"use client";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { textRoleClassName } from "@/components/typography";
import { formatCivilDate } from "@/lib/date-utils";
import { formatCompactCurrencyAmount, formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";
import { niceScale } from "@/modules/stats/lib/chart-scale";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsChartCopy, statsTabCopy } from "@/copy/stats";

interface StatsCumulativeChartProps {
  /** The period's daily totals so far. */
  data: { date: string; total: string }[];
  /** The days recorded so far: the period's first day through today (or its end). */
  range: { from: string; to: string };
  /** The period's own last day, which the axis runs to. */
  periodEnd: string;
  /** Where the period is heading, drawn from today to `periodEnd`; null draws nothing. */
  forecast: string | null;
  /**
   * The forecast's low, middle and high running total for each day after
   * today. With it the chart draws the spread as a band and the middle as the
   * line, ending at the last day's middle instead of `forecast`.
   */
  forecastBand?: readonly { p10: string; p50: string; p90: string }[] | null;
  /** The day the current way of spending began; marked when it falls within the days recorded. */
  changeDate?: string | null;
  /** The comparison period whole, and what it came to; null when there is nothing to compare. */
  previous: {
    data: { date: string; total: string }[];
    from: string;
    to: string;
    total: string;
    /** Its name, e.g. 上月. */
    label: string;
  } | null;
  currencySymbol: string;
}

const PLOT_HEIGHT = 160;

/** Running totals, one per day from `from` to `to`. */
function runningTotals(data: { date: string; total: string }[], from: string, to: string) {
  const byDate = new Map(data.map((point) => [point.date, Number(point.total)]));
  const days = civilDaysBetween(from, to) + 1;
  const totals: number[] = [];
  let sum = 0;
  for (let index = 0; index < days; index++) {
    sum += byDate.get(addCivilDays(from, index)) ?? 0;
    totals.push(sum);
  }
  return totals;
}

/**
 * How the period's spending adds up, day by day, against the whole of the
 * previous period. The daily columns answer "which days"; this answers "am I
 * spending faster than last time", and — while the period runs — where it is
 * heading if the rest of it goes the way a typical day does.
 *
 * The two periods are lined up by how far through each one a day is, so a
 * 28-day February and a 31-day March start and end together.
 */
export function StatsCumulativeChart({
  data,
  range,
  periodEnd,
  forecast,
  forecastBand = null,
  changeDate = null,
  previous,
  currencySymbol,
}: StatsCumulativeChartProps) {
  const locale = DISPLAY_LOCALE;
  const plotRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const days = civilDaysBetween(range.from, periodEnd) + 1;
  const current = useMemo(
    () => runningTotals(data, range.from, range.to),
    [data, range.from, range.to]
  );
  const previousTotals = useMemo(
    () => (previous == null ? [] : runningTotals(previous.data, previous.from, previous.to)),
    [previous]
  );
  const today = current.length - 1;
  // A band that does not cover exactly the days after today belongs to other
  // figures (a refetch in flight) and is not drawn.
  const band = useMemo(
    () =>
      forecastBand == null || forecastBand.length === 0 || forecastBand.length !== days - 1 - today
        ? null
        : forecastBand.map((day) => ({
            p10: Number(day.p10),
            p50: Number(day.p50),
            p90: Number(day.p90),
          })),
    [days, forecastBand, today]
  );
  const forecastValue =
    band != null ? band.at(-1)!.p50 : forecast == null ? null : Number(forecast);

  const values = [
    ...current,
    ...previousTotals,
    ...(forecastValue == null ? [] : [forecastValue]),
    ...(band == null ? [] : band.flatMap((day) => [day.p10, day.p90])),
  ];
  const scale = niceScale(Math.max(0, ...values));
  const minValue = Math.min(0, ...values);
  const span = scale.max - minValue;
  const x = (index: number, length: number) => (length <= 1 ? 50 : (index / (length - 1)) * 100);
  const y = (value: number) => ((scale.max - value) / span) * 100;
  const path = (totals: number[], length: number) =>
    totals.map((value, index) => `${x(index, length)},${y(value)}`).join(" ");
  /** The previous period's running total at the same point through its span. */
  const previousAt = (index: number) =>
    previousTotals.length === 0
      ? null
      : previousTotals[
          Math.round((days <= 1 ? 0 : index / (days - 1)) * (previousTotals.length - 1))
        ]!;

  const money = (value: number | string) =>
    formatCurrencyAmount(String(value), currencySymbol, locale);
  const spent = current[today] ?? 0;
  /** The forecast's end, while there are days left for it to cover. */
  const forecastEnd = forecastValue != null && today < days - 1 ? forecastValue : null;

  const pick = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (rect == null || rect.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (days - 1)));
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>) => pick(event.clientX);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((index) => Math.min(days - 1, Math.max(0, (index ?? today) + step)));
  };

  if (current.length === 0) {
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

  const bandEnd = band?.at(-1) ?? null;
  const summary = [
    `${statsTabCopy.thisPeriod} ${money(spent)}`,
    forecastEnd != null ? statsTabCopy.forecastEnd({ amount: money(forecastEnd) }) : null,
    bandEnd != null
      ? statsTabCopy.forecastRange({ low: money(bandEnd.p10), high: money(bandEnd.p90) })
      : null,
    previous == null
      ? null
      : statsTabCopy.previousEnd({ period: previous.label, amount: money(previous.total) }),
  ].filter((part) => part != null);

  const activeDate = active == null ? null : addCivilDays(range.from, active);
  const activeCurrent =
    active == null
      ? null
      : active <= today
        ? current[active]!
        : band != null
          ? band[active - today - 1]!.p50
          : forecastEnd != null
            ? spent + ((forecastEnd - spent) * (active - today)) / (days - 1 - today)
            : null;
  const activeBand =
    active == null || band == null || active <= today ? null : band[active - today - 1]!;
  const activePrevious = active == null ? null : previousAt(active);
  const activeLeft = active == null ? 0 : x(active, days);
  // The first day has nothing before it to have changed from.
  const changeIndex =
    changeDate == null || changeDate <= range.from || changeDate > range.to
      ? null
      : civilDaysBetween(range.from, changeDate);

  return (
    <div className="relative w-full select-none pt-12">
      {/* The legend carries each line's end value, so no label has to fight
          for room at the right edge where the lines converge. */}
      <ul className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-micro text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 border-t-2 border-primary" />
          {statsTabCopy.thisPeriod}
          <span className="font-medium tabular-nums text-text">{money(spent)}</span>
        </li>
        {forecastEnd != null ? (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-primary" />
            {statsTabCopy.forecastLine}
            <span className="font-medium tabular-nums text-text">{money(forecastEnd)}</span>
            {bandEnd != null ? (
              <span className="tabular-nums">
                {statsTabCopy.forecastRange({ low: money(bandEnd.p10), high: money(bandEnd.p90) })}
              </span>
            ) : null}
          </li>
        ) : null}
        {previous != null ? (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="w-4 border-t-[1.5px] border-dashed border-muted-foreground"
            />
            {previous.label}
            <span className="font-medium tabular-nums text-text">{money(previous.total)}</span>
          </li>
        ) : null}
      </ul>

      <div
        ref={plotRef}
        role="img"
        tabIndex={0}
        aria-label={`${statsTabCopy.cumulativeExpense}：${summary.join("，")}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative ml-12 mr-2 touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
        style={{ height: `${PLOT_HEIGHT}px` }}
      >
        {scale.ticks.map((tick) => (
          <div
            key={tick}
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: `${y(tick)}%` }}
          >
            <span className="absolute right-full -translate-y-1/2 pr-2 text-micro tabular-nums text-muted-foreground">
              {formatCompactCurrencyAmount(tick, currencySymbol, locale)}
            </span>
          </div>
        ))}

        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {previousTotals.length > 1 ? (
            <polyline
              points={path(previousTotals, previousTotals.length)}
              fill="none"
              stroke="currentColor"
              className="text-muted-foreground"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {band != null ? (
            <>
              <polygon
                points={[
                  `${x(today, days)},${y(spent)}`,
                  ...band.map((day, index) => `${x(today + 1 + index, days)},${y(day.p90)}`),
                  ...band
                    .map((day, index) => `${x(today + 1 + index, days)},${y(day.p10)}`)
                    .reverse(),
                ].join(" ")}
                fill="currentColor"
                className="text-primary"
                opacity="0.12"
              />
              <polyline
                points={[
                  `${x(today, days)},${y(spent)}`,
                  ...band.map((day, index) => `${x(today + 1 + index, days)},${y(day.p50)}`),
                ].join(" ")}
                fill="none"
                stroke="currentColor"
                className="text-primary"
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeLinejoin="round"
                opacity="0.6"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : forecastEnd != null ? (
            <polyline
              points={`${x(today, days)},${y(spent)} 100,${y(forecastEnd)}`}
              fill="none"
              stroke="currentColor"
              className="text-primary"
              strokeWidth="2"
              strokeDasharray="5 4"
              opacity="0.6"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <polyline
            points={path(current, days)}
            fill="none"
            stroke="currentColor"
            className="text-primary"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {changeIndex != null ? (
          <div
            aria-hidden="true"
            data-testid="cumulative-change-marker"
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-warning"
            style={{ left: `${x(changeIndex, days)}%` }}
          />
        ) : null}

        {/* Today's end of the line, ringed in the surface so it stays clear of
            the lines it meets. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-surface"
          style={{ left: `${x(today, days)}%`, top: `${y(spent)}%` }}
        />

        {active != null && activeDate != null ? (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-l border-border"
              style={{ left: `${activeLeft}%` }}
            />
            <div
              role="tooltip"
              className={cn(
                textRoleClassName(
                  "meta",
                  "pointer-events-none absolute top-0 z-tooltip whitespace-nowrap rounded border bg-popover px-2 py-1.5 text-popover-foreground shadow-lg"
                ),
                activeLeft < 50 ? "ml-2" : "-translate-x-full -ml-2"
              )}
              style={{ left: `${activeLeft}%` }}
            >
              <div className="font-medium text-text">
                {formatCivilDate(activeDate, locale, { month: "numeric", day: "numeric" })}
              </div>
              {activeCurrent != null ? (
                <div className="tabular-nums">
                  {active > today ? statsTabCopy.forecastLine : statsTabCopy.thisPeriod}{" "}
                  {money(activeCurrent.toFixed(2))}
                </div>
              ) : null}
              {activeBand != null ? (
                <div className="tabular-nums text-muted-foreground">
                  {statsTabCopy.forecastRange({
                    low: money(activeBand.p10.toFixed(2)),
                    high: money(activeBand.p90.toFixed(2)),
                  })}
                </div>
              ) : null}
              {active === changeIndex ? (
                <div className="text-warning">{statsTabCopy.changeMarker}</div>
              ) : null}
              {activePrevious != null && previous != null ? (
                <div className="tabular-nums">
                  {previous.label} {money(activePrevious.toFixed(2))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="relative ml-12 mr-2 h-6 text-micro text-muted-foreground">
        <span className="absolute left-0 top-1">
          {formatCivilDate(range.from, locale, { month: "numeric", day: "numeric" })}
        </span>
        <span className="absolute right-0 top-1">
          {formatCivilDate(periodEnd, locale, { month: "numeric", day: "numeric" })}
        </span>
      </div>
    </div>
  );
}
