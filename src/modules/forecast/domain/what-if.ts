import { quantile, type Quantiles } from "./simulate";

export interface WhatIfOutcome extends Quantiles {
  /** The share of paths that end above the previous period's total; null with none to compare. */
  exceedPrevious: number | null;
}

/**
 * Where the period ends if the rest of it goes differently in some
 * categories: each category's simulated paths are scaled by its factor (0.8
 * for a fifth less) and added back up path by path, so the spread stays the
 * spread of whole paths. A category without paths adds nothing more.
 *
 * Returns null without any paths to add up.
 */
export function whatIfOutcome(input: {
  spent: number;
  categories: readonly { samples: readonly number[]; factor: number }[];
  previousTotal: number | null;
}): WhatIfOutcome | null {
  const paths = Math.max(0, ...input.categories.map((category) => category.samples.length));
  if (paths === 0) return null;
  const totals = new Float64Array(paths).fill(input.spent);
  for (const category of input.categories) {
    for (let path = 0; path < category.samples.length; path++) {
      totals[path] = totals[path]! + category.samples[path]! * category.factor;
    }
  }
  totals.sort();
  return {
    p10: quantile(totals, 0.1),
    p50: quantile(totals, 0.5),
    p90: quantile(totals, 0.9),
    exceedPrevious:
      input.previousTotal == null || input.previousTotal <= 0
        ? null
        : totals.reduce((count, total) => count + (total > input.previousTotal! ? 1 : 0), 0) /
          paths,
  };
}
