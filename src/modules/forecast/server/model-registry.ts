import "server-only";
import {
  FORECAST_BACKTEST_HORIZON_DAYS,
  FORECAST_BACKTEST_ORIGINS,
  FORECAST_BACKTEST_PATHS,
  FORECAST_BACKTEST_SPACING_DAYS,
  FORECAST_CHANGE_DISCOUNT,
  FORECAST_HALF_LIFE_CANDIDATES,
  FORECAST_HALF_LIFE_DAYS,
  FORECAST_MIN_HISTORY_DAYS,
  FORECAST_MODEL_MAX_AGE_DAYS,
  FORECAST_NETWORK,
} from "@/config/tuning";
import { logger } from "@/lib/logger";
import { seedOf } from "@/modules/forecast/domain/random";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { trainForecast, type TrainedForecast } from "@/modules/forecast/domain/training";
import { civilDaysBetween } from "@/modules/ledger/domain/period";

// The trained forecasts live on `globalThis`: the nightly training runs from instrumentation and the
// forecast is read in route bundles, and the two do not share module instances. Nothing is stored in
// the database — a trained forecast is derived from the ledger, and after a restart the first read
// trains it again in a few seconds.

interface Registry {
  trained: Map<string, TrainedForecast>;
  running: Map<string, Promise<TrainedForecast>>;
}

const REGISTRY_KEY = Symbol.for("cashier.forecast.models");

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (holder[REGISTRY_KEY] ??= { trained: new Map(), running: new Map() });
}

/** The key a book's forecast, or every book's together, is trained under. */
export function forecastScope(bookId: string | undefined): string {
  return bookId ?? "all";
}

/**
 * The trained forecast to use for `scope` today, or null when there is none
 * yet, it is too old, or it was trained before the latest change in the way
 * of spending.
 */
export function currentTraining(
  scope: string,
  today: string,
  changeDate: string | null
): TrainedForecast | null {
  const trained = registry().trained.get(scope);
  if (trained == null || trained.changeDate !== changeDate) return null;
  const age = civilDaysBetween(trained.asOf, today);
  return age >= 0 && age <= FORECAST_MODEL_MAX_AGE_DAYS ? trained : null;
}

/**
 * Trains `scope`'s forecast on `rows` as of `today`, letting other work run
 * between epochs. One training per scope runs at a time; asking again while
 * it runs waits for the same one.
 */
export function trainScope(
  scope: string,
  rows: readonly HistoryRow[],
  today: string
): Promise<TrainedForecast> {
  const { running, trained } = registry();
  const existing = running.get(scope);
  if (existing != null) return existing;
  const run = (async () => {
    const startedAt = Date.now();
    const steps = trainForecast(rows, today, {
      defaultHalfLifeDays: FORECAST_HALF_LIFE_DAYS,
      backtest: {
        halfLives: FORECAST_HALF_LIFE_CANDIDATES,
        changeDiscount: FORECAST_CHANGE_DISCOUNT,
        origins: FORECAST_BACKTEST_ORIGINS,
        spacing: FORECAST_BACKTEST_SPACING_DAYS,
        horizon: FORECAST_BACKTEST_HORIZON_DAYS,
        paths: FORECAST_BACKTEST_PATHS,
        seed: seedOf(`${today}:${scope}:training`),
        minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
        network: FORECAST_NETWORK,
      },
    });
    let step = steps.next();
    while (step.done !== true) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      step = steps.next();
    }
    const result = step.value;
    trained.set(scope, result);
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        halfLifeDays: result.halfLifeDays,
        networkShare: Number(result.networkShare.toFixed(2)),
        origins: result.backtest?.origins ?? 0,
        statisticalError: result.backtest?.statistical.error,
        networkError: result.backtest?.network?.error,
        ensembleError: result.backtest?.ensemble.error,
      },
      "Forecast trained"
    );
    return result;
  })().finally(() => running.delete(scope));
  running.set(scope, run);
  return run;
}

/** Starts training `scope` without waiting for it; a failure is logged, and the next read tries again. */
export function trainScopeInBackground(
  scope: string,
  rows: readonly HistoryRow[],
  today: string
): void {
  trainScope(scope, rows, today).catch((error: unknown) => {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Forecast training failed"
    );
  });
}
