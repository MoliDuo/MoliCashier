import "server-only";
import {
  FORECAST_HALF_LIFE_DAYS,
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_HISTORY_DAYS,
  FORECAST_SIMULATION_PATHS,
} from "@/config/tuning";
import { ValidationError } from "@/lib/errors";
import { forecastInputSchema } from "@/modules/forecast/contract-schemas";
import type { ForecastDto, ForecastRangeDto } from "@/modules/forecast/contracts";
import { forecastPeriod } from "@/modules/forecast/domain/forecast";
import { seedOf } from "@/modules/forecast/domain/random";
import { UNCATEGORIZED_KEY } from "@/modules/forecast/domain/series";
import type { Quantiles } from "@/modules/forecast/domain/simulate";
import { addCivilDays, periodKey, resolveComparison } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { readForecastHistory } from "./forecast-history";

function money(value: number): string {
  const fixed = value.toFixed(2);
  return fixed === "-0.00" ? "0.00" : fixed;
}

function rangeDto(quantiles: Quantiles): ForecastRangeDto {
  return { p10: money(quantiles.p10), p50: money(quantiles.p50), p90: money(quantiles.p90) };
}

/**
 * The forecast for 统计's period, or null when the period is not a calendar
 * period that is still running. The period is resolved here, from the
 * ledger's today, exactly as 统计's own read resolves it.
 */
export async function getPeriodForecast(
  input: unknown,
  timeZone: string
): Promise<ForecastDto | null> {
  const parsed = forecastInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", { issues: parsed.error.issues });
  }
  const { bookId, period } = parsed.data;
  const today = ledgerToday(timeZone);
  const window = resolveComparison(period, today);
  if (window.mode !== "same_period") return null;

  const previous = { from: window.compareRange.from, to: window.previousWholeTo };
  const historyStart = addCivilDays(today, -(FORECAST_HISTORY_DAYS - 1));
  const history = await readForecastHistory(
    { from: previous.from < historyStart ? previous.from : historyStart, to: today },
    bookId
  );
  const forecast = forecastPeriod({
    rows: history.rows,
    today,
    period: { from: window.range.from, end: window.periodEnd },
    previous,
    options: {
      halfLifeDays: FORECAST_HALF_LIFE_DAYS,
      paths: FORECAST_SIMULATION_PATHS,
      seed: seedOf(`${today}:${bookId ?? "all"}:${periodKey(period)}`),
      minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
    },
  });
  if (forecast == null) return null;

  return {
    asOf: today,
    periodEnd: window.periodEnd,
    currency: history.mainCurrency,
    historyFrom: forecast.historyFrom,
    halfLifeDays: FORECAST_HALF_LIFE_DAYS,
    spent: forecast.spent,
    total: rangeDto(forecast.total),
    running: forecast.running.map(rangeDto),
    categories: forecast.categories.map((category) => {
      const meta =
        category.key === UNCATEGORIZED_KEY ? undefined : history.categories.get(category.key);
      return {
        id: category.key === UNCATEGORIZED_KEY ? null : category.key,
        name: meta?.name ?? null,
        icon: meta?.icon ?? null,
        spent: category.spent,
        forecast: rangeDto(category.forecast),
      };
    }),
    exceedPrevious: forecast.exceedPrevious,
  };
}
