import { addCivilDays } from "@/modules/ledger/domain/period";
import { dayWeights, prepareHistory, type PreparedHistory } from "./history";
import { trainNetwork, type NetworkModel, type NetworkOptions } from "./nn/network";
import { simulateOutlook } from "./outlook";
import { seededRandom } from "./random";
import type { HistoryRow } from "./series";
import { quantile } from "./simulate";

export interface BacktestOptions {
  /** The half-lives tried; null counts every day the same. */
  halfLives: readonly (number | null)[];
  changeDiscount: number;
  /** How many past days to stand on, how far apart, and how many days each one predicts. */
  origins: number;
  spacing: number;
  horizon: number;
  paths: number;
  seed: number;
  minHistoryDays: number;
  /** Null leaves the network out of the contest. */
  network: NetworkOptions | null;
}

/** How far a model's forecasts landed from what happened, over every day stood on. */
export interface ModelScore {
  /** The middle outcome's miss as a share of what was spent: 0.11 reads "±11%". */
  error: number;
  /** The pinball loss of the low, middle and high outcomes, as a share of what was spent. */
  loss: number;
}

export interface BacktestResult {
  /** How many past days the scores were taken on. */
  origins: number;
  horizon: number;
  /** The half-life whose statistical forecasts scored best. */
  halfLifeDays: number | null;
  statistical: ModelScore;
  network: ModelScore | null;
  /** The old rule — the typical day times the days left — as the bar to clear. */
  typicalDay: ModelScore;
  /** The share of paths the network plays: none unless it beat the statistical model. */
  networkShare: number;
  /** The scores of the mixture with that share. */
  ensemble: ModelScore;
}

const QUANTILES = [0.1, 0.5, 0.9] as const;
/** The days the typical day is read over, as 统计's own projection reads the period so far. */
const TYPICAL_DAYS = 28;
/** Fewer days stood on than this make a score that is mostly luck. */
const MIN_ORIGINS = 2;

interface Origin {
  history: PreparedHistory;
  actual: number;
}

interface Tally {
  miss: number;
  loss: number;
}

function score(tally: Tally, spent: number): ModelScore {
  return { error: tally.miss / spent, loss: tally.loss / spent };
}

/** Adds one day stood on: outcomes `totals`, sorted ascending, against `actual`. */
function tallyOutcome(tally: Tally, totals: Float64Array, actual: number): void {
  for (const tau of QUANTILES) {
    const residual = actual - quantile(totals, tau);
    tally.loss += residual >= 0 ? tau * residual : (tau - 1) * residual;
    if (tau === 0.5) tally.miss += Math.abs(residual);
  }
}

/**
 * The contest the forecast is chosen by. It stands on past days, every
 * `spacing` days back from yesterday, pretends nothing after each was known,
 * forecasts the next `horizon` days, and scores the forecast against what was
 * then spent.
 *
 * First the statistical model runs with every half-life, and the best one is
 * kept. Then the network is trained afresh on each of those days, with that
 * half-life, and scored the same way. It is trusted with a share of the paths
 * in proportion to how much better it did, and with none if it did worse: a
 * network that has not earned its place runs in the contest only.
 *
 * A generator, like the network's training, so that a server can let other
 * work run in between. Returns null with too few past days to stand on.
 */
export function* runBacktest(
  rows: readonly HistoryRow[],
  today: string,
  options: BacktestOptions
): Generator<void, BacktestResult | null> {
  const origins: Origin[] = [];
  for (let index = 0; index < options.origins; index++) {
    const origin = addCivilDays(today, -1 - options.horizon - index * options.spacing);
    const end = addCivilDays(origin, options.horizon);
    const history = prepareHistory(rows, origin, options.minHistoryDays);
    if (history == null) break;
    let actual = 0;
    for (const row of rows) if (row.date > origin && row.date <= end) actual += Number(row.amount);
    if (actual > 0) origins.push({ history, actual });
  }
  if (origins.length < MIN_ORIGINS) return null;
  const spent = origins.reduce((sum, origin) => sum + origin.actual, 0);

  const outcomes = (
    origin: Origin,
    halfLifeDays: number | null,
    network: NetworkModel | null,
    salt: number
  ) => {
    const simulation = simulateOutlook(origin.history, {
      weights: dayWeights(origin.history, halfLifeDays, options.changeDiscount),
      network,
      networkShare: network == null ? 0 : 1,
      end: addCivilDays(origin.history.today, options.horizon),
      paths: options.paths,
      random: seededRandom(options.seed + salt),
    });
    return Float64Array.from(simulation.running.at(-1)!).sort();
  };

  let best: { halfLifeDays: number | null; tally: Tally; totals: Float64Array[] } | null = null;
  for (const halfLifeDays of options.halfLives) {
    const tally = { miss: 0, loss: 0 };
    const totals: Float64Array[] = [];
    for (const [index, origin] of origins.entries()) {
      const sorted = outcomes(origin, halfLifeDays, null, index);
      tallyOutcome(tally, sorted, origin.actual);
      totals.push(sorted);
      yield;
    }
    if (best == null || tally.loss < best.tally.loss) best = { halfLifeDays, tally, totals };
  }
  const chosen = best!;

  const typical = { miss: 0, loss: 0 };
  for (const origin of origins) {
    const days = origin.history.signals.totals.slice(-TYPICAL_DAYS).sort();
    const forecast = quantile(days, 0.5) * options.horizon;
    tallyOutcome(typical, Float64Array.of(forecast), origin.actual);
  }

  let networkTally: Tally | null = null;
  const networkTotals: Float64Array[] = [];
  if (options.network != null) {
    networkTally = { miss: 0, loss: 0 };
    for (const [index, origin] of origins.entries()) {
      const model = yield* trainNetwork({
        series: origin.history.series,
        signals: origin.history.signals,
        change: origin.history.change,
        weights: dayWeights(origin.history, chosen.halfLifeDays, options.changeDiscount),
        random: seededRandom(options.seed + 1000 + index),
        options: options.network,
      });
      if (model == null) {
        networkTally = null;
        break;
      }
      const sorted = outcomes(origin, chosen.halfLifeDays, model, index);
      tallyOutcome(networkTally, sorted, origin.actual);
      networkTotals.push(sorted);
    }
  }

  const networkShare =
    networkTally == null || networkTally.loss >= chosen.tally.loss
      ? 0
      : chosen.tally.loss / (chosen.tally.loss + networkTally.loss);
  const ensemble = { miss: 0, loss: 0 };
  for (const [index, origin] of origins.entries()) {
    const statistical = chosen.totals[index]!;
    const fromNetwork = Math.round(statistical.length * networkShare);
    const mixed = new Float64Array(statistical.length);
    // Evenly spread picks from each model's sorted outcomes carry each one's spread into the mix.
    for (let path = 0; path < statistical.length; path++) {
      mixed[path] =
        path < fromNetwork
          ? networkTotals[index]![Math.floor((path * statistical.length) / fromNetwork)]!
          : statistical[
              Math.floor(
                ((path - fromNetwork) * statistical.length) / (statistical.length - fromNetwork)
              )
            ]!;
    }
    tallyOutcome(ensemble, mixed.sort(), origin.actual);
  }

  return {
    origins: origins.length,
    horizon: options.horizon,
    halfLifeDays: chosen.halfLifeDays,
    statistical: score(chosen.tally, spent),
    network: networkTally == null ? null : score(networkTally, spent),
    typicalDay: score(typical, spent),
    networkShare,
    ensemble: score(ensemble, spent),
  };
}
