/**
 * The one period model every ledger view reads by: a calendar week, month or
 * year counted from the current one, everything, or two named days.
 *
 * It is plain civil-date arithmetic on "YYYY-MM-DD" strings, done in UTC so no
 * runtime zone can shift a day. "Today" is always passed in — the server takes
 * it in the ledger's zone — so the same period means the same days wherever it
 * is resolved.
 */

export const CALENDAR_RANGES = ["week", "month", "year"] as const;
export type CalendarRange = (typeof CALENDAR_RANGES)[number];
export type PeriodRange = CalendarRange | "all" | "custom";

export type Period =
  | { range: CalendarRange; offset: number }
  | { range: "all" }
  | { range: "custom"; from: string; to: string };

export interface CivilRange {
  from: string;
  to: string;
}

export const DEFAULT_PERIOD: Period = { range: "month", offset: 0 };

/**
 * A read as the browser sends it: its days named by a period, which the server
 * turns into dates in the ledger's zone, instead of dates of its own.
 */
export type PeriodQuery<T> = Omit<T, "startDate" | "endDate"> & { period: Period };

/** How far back a calendar period can be stepped: ten years of each kind. */
export const MIN_PERIOD_OFFSET: Readonly<Record<CalendarRange, number>> = {
  week: -521,
  month: -119,
  year: -9,
};

/** How far ahead a calendar period can be stepped, for bills dated ahead: a year. */
export const MAX_PERIOD_OFFSET: Readonly<Record<CalendarRange, number>> = {
  week: 52,
  month: 12,
  year: 1,
};

/** The longest span one read may cover. */
export const MAX_PERIOD_DAYS = 3660;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtc(civil: string): Date {
  const match = CIVIL_DATE.exec(civil);
  if (match == null) throw new RangeError(`Invalid civil date: ${civil}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !CIVIL_DATE.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addCivilDays(civil: string, days: number): string {
  return fromUtc(new Date(toUtc(civil).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to`; zero for the same day. */
export function civilDaysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

/** The calendar week (Monday first), month or year that holds `day`. */
export function calendarRangeOf(range: CalendarRange, day: string): CivilRange {
  const date = toUtc(day);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (range) {
    case "week": {
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      const from = addCivilDays(day, -sinceMonday);
      return { from, to: addCivilDays(from, 6) };
    }
    case "month":
      return {
        from: fromUtc(new Date(Date.UTC(year, month, 1))),
        to: fromUtc(new Date(Date.UTC(year, month + 1, 0))),
      };
    case "year":
      return {
        from: fromUtc(new Date(Date.UTC(year, 0, 1))),
        to: fromUtc(new Date(Date.UTC(year, 11, 31))),
      };
  }
}

/** The first day of the calendar period `offset` steps from the one holding `today`. */
function shiftedAnchor(range: CalendarRange, today: string, offset: number): string {
  const start = calendarRangeOf(range, today).from;
  if (range === "week") return addCivilDays(start, offset * 7);
  const date = toUtc(start);
  return range === "month"
    ? fromUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)))
    : fromUtc(new Date(Date.UTC(date.getUTCFullYear() + offset, 0, 1)));
}

/** The days a period covers, whole; `null` for everything. */
export function resolvePeriod(period: Period, today: string): CivilRange | null {
  switch (period.range) {
    case "all":
      return null;
    case "custom":
      return { from: period.from, to: period.to };
    default:
      return calendarRangeOf(period.range, shiftedAnchor(period.range, today, period.offset));
  }
}

function clampOffset(range: CalendarRange, offset: number): number {
  return Math.min(MAX_PERIOD_OFFSET[range], Math.max(MIN_PERIOD_OFFSET[range], offset));
}

/** A period one step earlier or later; only calendar periods can step. */
export function stepPeriod(period: Period, step: number): Period {
  if (period.range === "all" || period.range === "custom") return period;
  return { range: period.range, offset: clampOffset(period.range, period.offset + step) };
}

/** Whether `stepPeriod` would move the period, so a control can say it cannot. */
export function canStepPeriod(period: Period, step: number): boolean {
  if (period.range === "all" || period.range === "custom") return false;
  return clampOffset(period.range, period.offset + step) !== period.offset;
}

function calendarOffset(range: CalendarRange, offset: number): Period | null {
  return clampOffset(range, offset) === offset ? { range, offset } : null;
}

/**
 * The month period for `month` (1–12) of `year`, or null when it is further
 * ahead or further back than a period steps.
 */
export function monthPeriod(today: string, year: number, month: number): Period | null {
  const now = toUtc(today);
  return calendarOffset(
    "month",
    (year - now.getUTCFullYear()) * 12 + (month - 1 - now.getUTCMonth())
  );
}

/** The year period for `year`, or null outside the years a period reaches. */
export function yearPeriod(today: string, year: number): Period | null {
  return calendarOffset("year", year - toUtc(today).getUTCFullYear());
}

export interface ComparisonWindow {
  range: CivilRange;
  compareRange: CivilRange;
  /** "same_period" when the current period is cut at today and so is the one before it. */
  mode: "same_period" | "full_period";
  /** The period's own last day, past `range.to` while it is still running. */
  periodEnd: string;
  /**
   * The comparison period's own last day. Totals are compared up to
   * `compareRange.to`; the charts and the forecast read on to here, so the
   * reader can see where the previous period ended up.
   */
  previousWholeTo: string;
}

/**
 * What 统计 reads for a period and what it sets it against. The current
 * calendar period ends today, and the one before it is cut after the same
 * number of days, so a half-month is not measured against a whole one. A named
 * range is compared with the same number of days just before it. Everything is
 * read from `earliest` (the first dated record) to today.
 */
export function resolveComparison(
  period: Period,
  today: string,
  earliest: string | null = null
): ComparisonWindow {
  if (period.range === "all") {
    const floor = addCivilDays(today, -(MAX_PERIOD_DAYS - 1));
    const from = earliest == null || earliest > today ? today : earliest < floor ? floor : earliest;
    return { range: { from, to: today }, ...previousWindow({ from, to: today }) };
  }
  if (period.range === "custom") {
    const range = { from: period.from, to: period.to };
    return { range, ...previousWindow(range) };
  }
  const whole = resolvePeriod(period, today)!;
  const previous = calendarRangeOf(
    period.range,
    shiftedAnchor(period.range, today, period.offset - 1)
  );
  if (period.offset !== 0) {
    return {
      range: whole,
      compareRange: previous,
      mode: "full_period",
      periodEnd: whole.to,
      previousWholeTo: previous.to,
    };
  }
  const elapsed = civilDaysBetween(whole.from, today);
  const previousEnd = addCivilDays(previous.from, elapsed);
  return {
    range: { from: whole.from, to: today },
    compareRange: {
      from: previous.from,
      to: previousEnd < previous.to ? previousEnd : previous.to,
    },
    mode: "same_period",
    periodEnd: whole.to,
    previousWholeTo: previous.to,
  };
}

function previousWindow(
  range: CivilRange
): Pick<ComparisonWindow, "compareRange" | "mode" | "periodEnd" | "previousWholeTo"> {
  const days = civilDaysBetween(range.from, range.to) + 1;
  const compareRange = {
    from: addCivilDays(range.from, -days),
    to: addCivilDays(range.from, -1),
  };
  return {
    compareRange,
    mode: "full_period",
    periodEnd: range.to,
    previousWholeTo: compareRange.to,
  };
}

/** Reads a period from its URL-shaped fields, falling back to this month. */
export function parsePeriod(fields: {
  range?: string | null | undefined;
  offset?: string | number | null | undefined;
  from?: string | null | undefined;
  to?: string | null | undefined;
}): Period {
  const range = fields.range ?? "month";
  if (range === "all") return { range: "all" };
  if (range === "custom") {
    if (!isCivilDate(fields.from) || !isCivilDate(fields.to) || fields.from > fields.to) {
      return DEFAULT_PERIOD;
    }
    // A span longer than one read may cover keeps its last days.
    const floor = addCivilDays(fields.to, -(MAX_PERIOD_DAYS - 1));
    return { range: "custom", from: fields.from < floor ? floor : fields.from, to: fields.to };
  }
  if (!(CALENDAR_RANGES as readonly string[]).includes(range)) return DEFAULT_PERIOD;
  const calendar = range as CalendarRange;
  const offset = Number(fields.offset ?? 0);
  return {
    range: calendar,
    offset: Number.isInteger(offset) ? clampOffset(calendar, offset) : 0,
  };
}

/** A stable string for a period, for query keys and comparisons. */
export function periodKey(period: Period): string {
  switch (period.range) {
    case "all":
      return "all";
    case "custom":
      return `custom:${period.from}:${period.to}`;
    default:
      return `${period.range}:${period.offset}`;
  }
}
