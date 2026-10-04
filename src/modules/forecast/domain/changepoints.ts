/**
 * Bayesian online changepoint detection (Adams & MacKay, 2007). Each step
 * carries a few measurements, each modelled as a normal whose level and spread
 * are unknown and stay put within one regime. For every step it answers: how
 * long has the current regime been going?
 *
 * A measurement that is missing on a step (NaN) says nothing on that step.
 */

/** Where a measurement is expected to sit, and how much it wanders within one regime. */
export interface MeasurementPrior {
  mean: number;
  variance: number;
}

interface Posterior {
  mean: number;
  kappa: number;
  alpha: number;
  beta: number;
}

/** How many steps' worth of belief the prior level carries: hardly any, so a regime's level is its own. */
const PRIOR_KAPPA = 0.1;
/**
 * A small shape keeps the predictive heavy-tailed: one odd week — a holiday,
 * a year's insurance — is improbable but not impossible within a regime, so it
 * does not start a new one by itself.
 */
const PRIOR_ALPHA = 1;

function priorPosterior(measurement: MeasurementPrior): Posterior {
  return {
    mean: measurement.mean,
    kappa: PRIOR_KAPPA,
    alpha: PRIOR_ALPHA,
    beta: PRIOR_ALPHA * measurement.variance,
  };
}

function update(posterior: Posterior, value: number): Posterior {
  if (Number.isNaN(value)) return posterior;
  const kappa = posterior.kappa + 1;
  return {
    mean: (posterior.kappa * posterior.mean + value) / kappa,
    kappa,
    alpha: posterior.alpha + 0.5,
    beta: posterior.beta + (posterior.kappa * (value - posterior.mean) ** 2) / (2 * kappa),
  };
}

/** The log density of `value` under the posterior's predictive Student-t. */
function logPredictive(posterior: Posterior, value: number): number {
  if (Number.isNaN(value)) return 0;
  const degrees = 2 * posterior.alpha;
  const scale = (posterior.beta * (posterior.kappa + 1)) / (posterior.alpha * posterior.kappa);
  return (
    logGamma((degrees + 1) / 2) -
    logGamma(degrees / 2) -
    0.5 * Math.log(degrees * Math.PI * scale) -
    ((degrees + 1) / 2) * Math.log1p((value - posterior.mean) ** 2 / (degrees * scale))
  );
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0, by the Lanczos approximation. */
function logGamma(x: number): number {
  const shifted = x - 1;
  let sum = LANCZOS[0]!;
  for (let index = 1; index < LANCZOS.length; index++) sum += LANCZOS[index]! / (shifted + index);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function logLikelihood(posteriors: readonly Posterior[], step: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < posteriors.length; index++) {
    total += logPredictive(posteriors[index]!, step[index]!);
  }
  return total;
}

/**
 * For each step, the most likely length of the regime it belongs to, in steps
 * and counting itself. `hazard` is the chance, on any step, that a new regime
 * begins. A length equal to the number of steps so far means no change yet.
 */
export function mostLikelyRunLengths(
  steps: readonly (readonly number[])[],
  priors: readonly MeasurementPrior[],
  hazard: number
): number[] {
  const fresh = priors.map(priorPosterior);
  // Entry i is a regime that has run i + 1 steps, counting the latest.
  let probabilities: number[] = [];
  let posteriors: Posterior[][] = [];
  const lengths: number[] = [];
  for (const step of steps) {
    const logFresh = logLikelihood(fresh, step);
    const logRuns = posteriors.map((run) => logLikelihood(run, step));
    const top = Math.max(logFresh, ...logRuns);
    // Either a regime begins with this step, or one already running goes on through it.
    const next = [
      (probabilities.length === 0 ? 1 : hazard) * Math.exp(logFresh - top),
      ...probabilities.map(
        (probability, index) => probability * (1 - hazard) * Math.exp(logRuns[index]! - top)
      ),
    ];
    const total = next.reduce((sum, value) => sum + value, 0);
    probabilities = next.map((value) => value / total);
    posteriors = [
      fresh.map((measurement, index) => update(measurement, step[index]!)),
      ...posteriors.map((run) =>
        run.map((measurement, index) => update(measurement, step[index]!))
      ),
    ];
    let best = 0;
    for (let index = 1; index < probabilities.length; index++) {
      if (probabilities[index]! > probabilities[best]!) best = index;
    }
    lengths.push(best + 1);
  }
  return lengths;
}
