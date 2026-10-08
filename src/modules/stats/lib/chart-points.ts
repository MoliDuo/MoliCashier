import type { DateRangeType } from "@/lib/date-utils";
import { parseDateString } from "@/lib/date-utils";
import Decimal from "decimal.js";

export interface ChartPoint {
  label: string;
  value: number;
  total: string;
  /** YYYY-MM-DD for daily granularity, YYYY-MM for yearly granularity, YYYY past ten years of months. */
  fullDate: string;
}

export interface BuildChartPointsInput {
  data: { date: string; total: string }[];
  rangeType: DateRangeType;
  /** Inclusive civil start date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive civil end date (YYYY-MM-DD), already truncated by the ledger timezone. */
  endDate: string;
  locale?: string;
}

export const MAX_CHART_POINTS = 120;

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCivilDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year == null || month == null || day == null) return dateStr;
  // UTC arithmetic keeps day iteration deterministic in any runtime timezone.
  return formatUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function isValidDateString(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * Builds the rendered chart points strictly from the queried range.
 *
 * The caller (stats state) already truncates the current period to today in the
 * ledger timezone; this function never reads the browser clock, so historical
 * periods render their full range and cross-timezone ledgers cannot lose days.
 */
export function buildChartPoints({
  data,
  rangeType,
  startDate,
  endDate,
  locale = "zh",
}: BuildChartPointsInput): ChartPoint[] {
  if (!isValidDateString(startDate) || !isValidDateString(endDate) || startDate > endDate) {
    return [];
  }

  // First occurrence wins, mirroring the previous find() semantics.
  const totalsByDate = new Map<string, string>();
  for (const point of data) {
    if (!totalsByDate.has(point.date)) {
      totalsByDate.set(point.date, point.total);
    }
  }

  if (rangeType === "year") {
    const startYear = Number(startDate.slice(0, 4));
    const startMonth = Number(startDate.slice(5, 7));
    const endYear = Number(endDate.slice(0, 4));
    const endMonth = Number(endDate.slice(5, 7));
    const monthCount = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
    if (monthCount <= 0) return [];
    // Past ten years of months the bars grow too thin to read; a bar a year keeps the span whole.
    if (monthCount > MAX_CHART_POINTS) return yearlyPoints(data, startYear, endYear);

    const points: ChartPoint[] = [];
    for (let index = 0; index < monthCount; index++) {
      const month = startMonth + index;
      const year = startYear + Math.floor((month - 1) / 12);
      const monthOfYear = ((month - 1) % 12) + 1;
      const monthPrefix = `${year}-${String(monthOfYear).padStart(2, "0")}`;
      let total = new Decimal(0);
      for (const point of data) {
        if (point.date.startsWith(monthPrefix)) {
          total = total.plus(point.total);
        }
      }
      const monthLabel = parseDateString(`${monthPrefix}-01`).toLocaleString(locale, {
        month: "short",
      });
      const totalString = total.toFixed();
      points.push({
        label: monthLabel,
        value: finiteCoordinate(totalString),
        total: totalString,
        fullDate: monthPrefix,
      });
    }
    return points;
  }

  const points: ChartPoint[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    if (points.length >= MAX_CHART_POINTS) return [];
    const total = totalsByDate.get(cursor) ?? "0";
    const label =
      rangeType === "week"
        ? parseDateString(cursor).toLocaleString(locale, { weekday: "short" })
        : String(Number(cursor.slice(8, 10)));
    points.push({ label, value: finiteCoordinate(total), total, fullDate: cursor });
    cursor = addCivilDays(cursor, 1);
  }
  return points;
}

/** One point a year from `startYear` through `endYear`, each the sum of its days. */
function yearlyPoints(
  data: BuildChartPointsInput["data"],
  startYear: number,
  endYear: number
): ChartPoint[] {
  const totals = new Map<string, Decimal>();
  for (const point of data) {
    const year = point.date.slice(0, 4);
    totals.set(year, (totals.get(year) ?? new Decimal(0)).plus(point.total));
  }
  const points: ChartPoint[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const key = String(year);
    const total = (totals.get(key) ?? new Decimal(0)).toFixed();
    points.push({ label: key, value: finiteCoordinate(total), total, fullDate: key });
  }
  return points;
}

function finiteCoordinate(value: string): number {
  const coordinate = new Decimal(value).toNumber();
  return Number.isFinite(coordinate) ? coordinate : Number.MAX_VALUE;
}
