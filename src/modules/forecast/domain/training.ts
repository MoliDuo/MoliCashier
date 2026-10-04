import { addCivilDays } from "@/modules/ledger/domain/period";
import { runBacktest, type BacktestOptions, type BacktestResult } from "./backtest";
import { dayWeights, prepareHistory } from "./history";
import { trainNetwork, type NetworkModel } from "./nn/network";
import { seededRandom } from "./random";
import type { HistoryRow } from "./series";

/** What a night's training leaves for the day's forecasts to use. */
export interface TrainedForecast {
  /** The day trained for: the history ran through the day before. */
  asOf: string;
  /** The change in the way of spending the training saw; a different one makes it stale. */
  changeDate: string | null;
  halfLifeDays: number | null;
  network: NetworkModel | null;
  networkShare: number;
  backtest: BacktestResult | null;
}

/**
 * Runs the contest, then trains the network on the whole history if it won
 * a share of the paths. With too little history for a contest, the default
 * half-life stands and the network sits out.
 */
export function* trainForecast(
  rows: readonly HistoryRow[],
  today: string,
  options: { backtest: BacktestOptions; defaultHalfLifeDays: number }
): Generator<void, TrainedForecast> {
  const history = prepareHistory(rows, today, options.backtest.minHistoryDays);
  const changeDate =
    history?.change == null ? null : addCivilDays(history.earliest, history.change.day);
  const backtest = yield* runBacktest(rows, today, options.backtest);
  const halfLifeDays = backtest == null ? options.defaultHalfLifeDays : backtest.halfLifeDays;
  let network: NetworkModel | null = null;
  if (
    history != null &&
    backtest != null &&
    backtest.networkShare > 0 &&
    options.backtest.network
  ) {
    network = yield* trainNetwork({
      series: history.series,
      signals: history.signals,
      change: history.change,
      weights: dayWeights(history, halfLifeDays, options.backtest.changeDiscount),
      random: seededRandom(options.backtest.seed),
      options: options.backtest.network,
    });
  }
  return {
    asOf: today,
    changeDate,
    halfLifeDays,
    network,
    networkShare: network == null ? 0 : backtest!.networkShare,
    backtest,
  };
}
