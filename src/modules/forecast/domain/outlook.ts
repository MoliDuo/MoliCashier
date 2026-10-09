import { civilDaysBetween } from "@/modules/ledger/domain/period";
import { billModels, statisticalModels, type PreparedHistory } from "./history";
import type { Random } from "./random";
import { simulate, type Simulation } from "./simulate";

export interface OutlookOptions {
  /** How much each day of the history counts. */
  weights: Float64Array;
  /** The last day played out; the first is tomorrow. */
  end: string;
  paths: number;
  random: Random;
}

/**
 * Plays the days after today through `end` out `paths` times: each category's
 * everyday spending as the statistical model learnt it, and the recurring
 * bills on their days, for certain.
 */
export function simulateOutlook(history: PreparedHistory, options: OutlookOptions): Simulation {
  const days = civilDaysBetween(history.today, options.end);
  return simulate(
    [...statisticalModels(history, options.weights), ...billModels(history, options.end)],
    {
      days,
      paths: options.paths,
      random: options.random,
    }
  );
}
