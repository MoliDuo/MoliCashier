"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import {
  CALENDAR_RANGES,
  civilDaysBetween,
  MAX_PERIOD_DAYS,
  MAX_PERIOD_OFFSET,
  MIN_PERIOD_OFFSET,
  monthPeriod,
  periodKey,
  resolvePeriod,
  yearPeriod,
  type Period,
  type PeriodRange,
} from "@/modules/ledger/domain/period";
import { formatPeriodLabel } from "../period-label";
import { periodBarCopy } from "@/copy/controls";

const RANGE_CHOICES: readonly PeriodRange[] = [...CALENDAR_RANGES, "all", "custom"];
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
/** The weeks listed by name; the arrows beside the period reach further back. */
const LISTED_WEEKS = 6;
/** The years a year period reaches, as offsets from this one. */
const LISTED_YEAR_OFFSETS = Array.from(
  { length: MAX_PERIOD_OFFSET.year - MIN_PERIOD_OFFSET.year + 1 },
  (_, index) => MIN_PERIOD_OFFSET.year + index
);

interface PeriodPickerProps {
  period: Period;
  /** Today in the ledger's zone, which every period is counted from. */
  today: string;
  /** Called with the chosen period; a tab alone only changes what is listed. */
  onChange: (period: Period) => void;
  /** The ledger's zone, so the custom pickers name 今天 the ledger's way. */
  timeZone?: string;
  className?: string;
}

/**
 * Picks the days a view reads in one place: the tabs choose the kind of
 * period, and the grid below names each one — the months of a year, the last
 * ten years, the latest weeks, or two named days. Picking a cell applies it;
 * 全部 has nothing to list and applies at once.
 */
export function PeriodPicker({ period, today, onChange, timeZone, className }: PeriodPickerProps) {
  const current = resolvePeriod(period, today);
  const thisYear = Number(today.slice(0, 4));
  const [view, setView] = useState<PeriodRange>(period.range);
  const [shownYear, setShownYear] = useState(
    period.range === "month" && current != null ? Number(current.from.slice(0, 4)) : thisYear
  );
  const [from, setFrom] = useState(current?.from ?? today);
  const [to, setTo] = useState(current?.to ?? today);
  const customTooLong = from <= to && civilDaysBetween(from, to) + 1 > MAX_PERIOD_DAYS;
  const selectedKey = periodKey(period);

  const choose = (range: PeriodRange) => {
    if (range === "all") onChange({ range: "all" });
    else setView(range);
  };

  const cell = (next: Period | null, label: string, name = label) => {
    const selected = next != null && periodKey(next) === selectedKey;
    return (
      <button
        key={name}
        type="button"
        disabled={next == null}
        aria-pressed={selected}
        aria-label={name}
        onClick={() => next != null && onChange(next)}
        className={cn(
          textRoleClassName(
            "body",
            "min-h-11 whitespace-nowrap rounded-md px-1 tabular-nums transition-colors duration-[var(--motion-feedback)] disabled:opacity-40 md:min-h-9"
          ),
          selected ? "bg-primary/10 font-medium text-primary" : "hover:bg-surface2"
        )}
      >
        {label}
      </button>
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-1 rounded-lg bg-surface2 p-1" role="group">
        {RANGE_CHOICES.map((range) => {
          const active = view === range;
          return (
            <button
              key={range}
              type="button"
              aria-pressed={active}
              onClick={() => choose(range)}
              className={cn(
                textRoleClassName(
                  "bodyStrong",
                  "min-h-11 flex-1 whitespace-nowrap rounded-md px-1 transition-colors duration-[var(--motion-feedback)] sm:px-2 md:min-h-9"
                ),
                active
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted-foreground hover:text-text"
              )}
            >
              {periodBarCopy[range]}
            </button>
          );
        })}
      </div>

      {view === "month" ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={monthPeriod(today, shownYear - 1, 12) == null}
              onClick={() => setShownYear((year) => year - 1)}
              aria-label={periodBarCopy.previousYear}
              title={periodBarCopy.previousYear}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className={textRoleClassName("bodyStrong", "tabular-nums")}>
              {periodBarCopy.yearName({ year: shownYear })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={monthPeriod(today, shownYear + 1, 1) == null}
              onClick={() => setShownYear((year) => year + 1)}
              aria-label={periodBarCopy.nextYear}
              title={periodBarCopy.nextYear}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {MONTHS.map((month) =>
              cell(
                monthPeriod(today, shownYear, month),
                periodBarCopy.monthName({ month }),
                `${periodBarCopy.yearName({ year: shownYear })}${periodBarCopy.monthName({ month })}`
              )
            )}
          </div>
        </div>
      ) : view === "year" ? (
        <div className="grid grid-cols-5 gap-1">
          {LISTED_YEAR_OFFSETS.map((offset) => {
            const year = thisYear + offset;
            return cell(yearPeriod(today, year), periodBarCopy.yearName({ year }));
          })}
        </div>
      ) : view === "week" ? (
        <div className="grid grid-cols-2 gap-1">
          {Array.from({ length: LISTED_WEEKS }, (_, index) => {
            const week: Period = { range: "week", offset: -index };
            return cell(week, formatPeriodLabel(week, today));
          })}
        </div>
      ) : view === "custom" ? (
        <div className="space-y-3">
          {/* Side by side the two dates get about 130px each on a phone,
              which cuts the date short, so they stack there. */}
          <div className="grid gap-2 sm:flex sm:items-center">
            <DateFilter
              value={from}
              onChange={(date) => date != null && setFrom(formatDateTimeForApi(date))}
              size="sm"
              className="h-9 w-full sm:flex-1"
              showClear={false}
              showClearShortcut={false}
              ariaLabel={periodBarCopy.from}
              {...(timeZone != null ? { timeZone } : {})}
            />
            <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
              –
            </span>
            <DateFilter
              value={to}
              onChange={(date) => date != null && setTo(formatDateTimeForApi(date))}
              size="sm"
              className="h-9 w-full sm:flex-1"
              showClear={false}
              showClearShortcut={false}
              ariaLabel={periodBarCopy.to}
              {...(timeZone != null ? { timeZone } : {})}
            />
          </div>
          {/* The server reads at most this many days at once; a longer span is
              refused here rather than cut short without a word. */}
          {customTooLong ? (
            <p role="alert" className={textRoleClassName("meta", "text-destructive")}>
              {periodBarCopy.customTooLong({ days: MAX_PERIOD_DAYS })}
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={from > to || customTooLong}
            onClick={() => onChange({ range: "custom", from, to })}
          >
            {periodBarCopy.apply}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
