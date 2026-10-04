import type { DayModel } from "./day-model";
import type { Random } from "./random";

/** A low, a middle and a high outcome: four in five simulated outcomes fall between `p10` and `p90`. */
export interface Quantiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface Simulation {
  /** Each simulated path's spending over the remaining days, per category. */
  byCategory: Map<string, Float64Array>;
  /** Each path's spending from tomorrow through each remaining day, all categories together. */
  running: Float64Array[];
}

/**
 * Plays the remaining days out `paths` times. On each day, each model
 * spends with its chance, and a day that spends costs one of its amounts.
 * Totals are summed per path, so the spread of the whole period is the spread
 * of whole paths, not the categories' spreads added up. A category may have
 * more than one model — its everyday spending and a bill that falls due — and
 * their amounts add up under its key.
 */
export function simulate(
  models: Iterable<readonly [string, DayModel]>,
  options: { days: number; paths: number; random: Random }
): Simulation {
  const { days, paths, random } = options;
  const byCategory = new Map<string, Float64Array>();
  const running = Array.from({ length: days }, () => new Float64Array(paths));
  for (const [key, model] of models) {
    const sums = byCategory.get(key) ?? new Float64Array(paths);
    for (let day = 1; day <= days; day++) {
      const chance = model.chance(day);
      const column = running[day - 1]!;
      for (let path = 0; path < paths; path++) {
        if (random() >= chance) continue;
        const amount = model.amount(day, random());
        sums[path] = sums[path]! + amount;
        column[path] = column[path]! + amount;
      }
    }
    byCategory.set(key, sums);
  }
  // Each day so far held only that day's spending; running totals add them up.
  for (let day = 1; day < days; day++) {
    const previous = running[day - 1]!;
    const column = running[day]!;
    for (let path = 0; path < paths; path++) column[path] = column[path]! + previous[path]!;
  }
  return { byCategory, running };
}

/** The value a share `q` of the ascending `sorted` falls below, interpolating between neighbours. */
export function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/** The low, middle and high outcome of a set of simulated values, each shifted by `offset`. */
export function quantilesOf(values: Float64Array, offset = 0): Quantiles {
  const sorted = Float64Array.from(values).sort();
  return {
    p10: offset + quantile(sorted, 0.1),
    p50: offset + quantile(sorted, 0.5),
    p90: offset + quantile(sorted, 0.9),
  };
}
