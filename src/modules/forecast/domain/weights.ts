/**
 * How much each past day counts, the last day most. A day `halfLifeDays` older
 * than the last one counts half as much; `null` counts every day the same.
 *
 * There is no fixed window: a window long enough to have data in it reaches
 * back into a different way of living, and one short enough to avoid that has
 * nothing in it when life has just changed. Fading the past keeps both.
 */
export function recencyWeights(length: number, halfLifeDays: number | null): Float64Array {
  const weights = new Float64Array(length);
  const decay = halfLifeDays == null ? 1 : Math.pow(0.5, 1 / halfLifeDays);
  let weight = 1;
  for (let day = length - 1; day >= 0; day--) {
    weights[day] = weight;
    weight *= decay;
  }
  return weights;
}
