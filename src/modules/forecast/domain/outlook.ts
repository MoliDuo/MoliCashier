import { civilDaysBetween } from "@/modules/ledger/domain/period";
import type { DayModel } from "./day-model";
import { billModels, statisticalModels, type PreparedHistory } from "./history";
import { networkDayModels, type NetworkModel } from "./nn/network";
import type { Random } from "./random";
import { simulate, type Simulation } from "./simulate";

export interface OutlookOptions {
  /** How much each day of the history counts. */
  weights: Float64Array;
  /** The trained network, if there is one, and the share of paths it plays. */
  network: NetworkModel | null;
  networkShare: number;
  /** The last day played out; the first is tomorrow. */
  end: string;
  paths: number;
  random: Random;
}

/**
 * Plays the days after today through `end` out `paths` times, as a mixture:
 * the network plays its share of the paths and the statistical model the
 * rest, so the spread is what either model thinks could happen, in proportion
 * to how far each is trusted. A category the network was not trained on is
 * played by the statistical model in the network's paths too, and the
 * recurring bills are added the same way in all of them.
 */
export function simulateOutlook(history: PreparedHistory, options: OutlookOptions): Simulation {
  const days = civilDaysBetween(history.today, options.end);
  const statistical = statisticalModels(history, options.weights);
  const bills = billModels(history, options.end);
  const networkPaths =
    options.network == null ? 0 : Math.round(options.paths * options.networkShare);

  const first = simulate([...statistical, ...bills], {
    days,
    paths: options.paths - networkPaths,
    random: options.random,
  });
  if (options.network == null || networkPaths === 0) return first;

  const mixed = new Map<string, DayModel>(statistical);
  for (const [key, model] of networkDayModels(options.network, {
    series: history.series,
    signals: history.signals,
    change: history.change,
    days,
  })) {
    mixed.set(key, model);
  }
  const second = simulate([...mixed, ...bills], {
    days,
    paths: networkPaths,
    random: options.random,
  });
  return concatenate(first, second);
}

/** Two simulations of the same days as one, the paths of `second` after those of `first`. */
function concatenate(first: Simulation, second: Simulation): Simulation {
  const firstPaths = first.running[0]?.length ?? 0;
  const secondPaths = second.running[0]?.length ?? 0;
  const join = (a: Float64Array | undefined, b: Float64Array | undefined) => {
    const joined = new Float64Array(firstPaths + secondPaths);
    if (a != null) joined.set(a);
    if (b != null) joined.set(b, firstPaths);
    return joined;
  };
  const byCategory = new Map<string, Float64Array>();
  for (const key of new Set([...first.byCategory.keys(), ...second.byCategory.keys()])) {
    byCategory.set(key, join(first.byCategory.get(key), second.byCategory.get(key)));
  }
  return {
    byCategory,
    running: first.running.map((column, day) => join(column, second.running[day])),
  };
}
