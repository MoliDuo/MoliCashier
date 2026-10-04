import "server-only";
import {
  FORECAST_CHANGE_DISCOUNT,
  FORECAST_HALF_LIFE_DAYS,
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_HISTORY_DAYS,
  FORECAST_SIMULATION_PATHS,
  FORECAST_WHAT_IF_SAMPLES,
} from "@/config/tuning";
import { ValidationError } from "@/lib/errors";
import { forecastInputSchema } from "@/modules/forecast/contract-schemas";
import type { ForecastDto, ForecastRangeDto } from "@/modules/forecast/contracts";
import { forecastPeriod } from "@/modules/forecast/domain/forecast";
import { prepareHistory } from "@/modules/forecast/domain/history";
import { seedOf } from "@/modules/forecast/domain/random";
import { UNCATEGORIZED_KEY } from "@/modules/forecast/domain/series";
import type { Quantiles } from "@/modules/forecast/domain/simulate";
import { addCivilDays, periodKey, resolveComparison } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { readForecastHistory } from "./forecast-history";
import { currentTraining, forecastScope, trainScopeInBackground } from "./model-registry";

function money(value: number): string {
  const fixed = value.toFixed(2);
  return fixed === "-0.00" ? "0.00" : fixed;
}

const cents = (value: number) => Math.round(value * 100) / 100;

function rangeDto(quantiles: Quantiles): ForecastRangeDto {
  return { p10: money(quantiles.p10), p50: money(quantiles.p50), p90: money(quantiles.p90) };
}

/**
 * The forecast for 统计's period, or null when the period is not a calendar
 * period that is still running. The period is resolved here, from the
 * ledger's today, exactly as 统计's own read resolves it.
 *
 * The read uses the scope's trained forecast — the half-life the nightly
 * contest chose and, if it earned a share, the network. Without one that is
 * current (none yet, too old, or trained before the latest change in the way
 * of spending) it answers from the statistical model with the default
 * half-life and starts training in the background for the next read.
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
  const scope = forecastScope(bookId);
  const prepared = prepareHistory(history.rows, today, FORECAST_MIN_HISTORY_DAYS);
  const changeDate =
    prepared?.change == null ? null : addCivilDays(prepared.earliest, prepared.change.day);
  const trained = currentTraining(scope, today, changeDate);
  if (trained == null && prepared != null) trainScopeInBackground(scope, history.rows, today);
  const halfLifeDays = trained?.halfLifeDays ?? FORECAST_HALF_LIFE_DAYS;

  const forecast = forecastPeriod({
    rows: history.rows,
    today,
    period: { from: window.range.from, end: window.periodEnd },
    previous,
    options: {
      halfLifeDays,
      changeDiscount: FORECAST_CHANGE_DISCOUNT,
      paths: FORECAST_SIMULATION_PATHS,
      seed: seedOf(`${today}:${bookId ?? "all"}:${periodKey(period)}`),
      minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
      network: trained?.network ?? null,
      networkShare: trained?.networkShare ?? 0,
      samples: FORECAST_WHAT_IF_SAMPLES,
    },
  });
  if (forecast == null) return null;

  return {
    asOf: today,
    periodEnd: window.periodEnd,
    currency: history.mainCurrency,
    historyFrom: forecast.historyFrom,
    halfLifeDays,
    spent: forecast.spent,
    total: rangeDto(forecast.total),
    running: forecast.running.map(rangeDto),
    categories: forecast.categories.map((category) => ({
      ...categoryOf(category.key),
      spent: category.spent,
      forecast: rangeDto(category.forecast),
      samples: category.samples.map(cents),
    })),
    exceedPrevious: forecast.exceedPrevious,
    lifeChange:
      forecast.lifeChange == null
        ? null
        : {
            date: forecast.lifeChange.date,
            dailyBefore: money(forecast.lifeChange.dailyBefore),
            dailyAfter: money(forecast.lifeChange.dailyAfter),
          },
    upcoming: forecast.upcoming.map((bill) => ({
      date: bill.date,
      label: bill.label,
      ...categoryOf(bill.key),
      amount: money(bill.amount),
      cadence: bill.cadence,
      streak: bill.streak,
    })),
    anomalies: forecast.anomalies.map((anomaly) => ({
      date: anomaly.date,
      ...categoryOf(anomaly.key),
      amount: money(anomaly.amount),
      typical: money(anomaly.typical),
    })),
    model:
      trained == null
        ? null
        : {
            trainedFor: trained.asOf,
            networkShare: Number(trained.networkShare.toFixed(2)),
            accuracy:
              trained.backtest == null
                ? null
                : {
                    origins: trained.backtest.origins,
                    horizonDays: trained.backtest.horizon,
                    error: Number(trained.backtest.ensemble.error.toFixed(3)),
                    statisticalError: Number(trained.backtest.statistical.error.toFixed(3)),
                    networkError:
                      trained.backtest.network == null
                        ? null
                        : Number(trained.backtest.network.error.toFixed(3)),
                    typicalDayError: Number(trained.backtest.typicalDay.error.toFixed(3)),
                  },
          },
  };

  function categoryOf(key: string) {
    const meta = key === UNCATEGORIZED_KEY ? undefined : history.categories.get(key);
    return {
      id: key === UNCATEGORIZED_KEY ? null : key,
      name: meta?.name ?? null,
      icon: meta?.icon ?? null,
    };
  }
}
