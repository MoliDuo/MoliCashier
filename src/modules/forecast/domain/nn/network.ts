import { addCivilDays } from "@/modules/ledger/domain/period";
import type { DayModel } from "../day-model";
import type { DailySignals, LifeChange } from "../life-change";
import { seededRandom, type Random } from "../random";
import { weekdayOf, type DailySeries } from "../series";
import {
  adamStep,
  backward,
  cloneMlp,
  createAdam,
  createMlp,
  forward,
  zeroGradients,
  type Mlp,
} from "./mlp";

/**
 * The challenger to the statistical model: one network for every category,
 * which reads where a category and the household as a whole have been lately
 * — how often and how much, this week against this month, which currency the
 * money goes out in, how long since life last changed — and says, for a day
 * to come, how likely the category is to spend and three points of what it
 * would cost.
 *
 * The statistical model treats every category alone and the past as one
 * pool; this one can learn that a jump in groceries comes with a jump in
 * household goods, or that the weeks right after a move spend differently
 * from the months after. Whether it does better is not assumed: the
 * backtest decides how much it is trusted.
 */
export interface NetworkModel {
  mlp: Mlp;
  /** The categories in the order of their one-hot inputs. */
  keys: readonly string[];
  /** What each of the continuous inputs is centred and scaled by. */
  mean: Float64Array;
  scale: Float64Array;
}

export interface NetworkOptions {
  hidden: readonly number[];
  maxEpochs: number;
  /** Epochs without a better validation loss before training stops. */
  patience: number;
  batchSize: number;
  learningRate: number;
  l2: number;
  /** The latest days held out to decide when to stop; they are trained on afterwards. */
  validationDays: number;
}

export interface NetworkTrainingInput {
  series: DailySeries;
  signals: DailySignals;
  change: LifeChange | null;
  /** How much each day of the series counts. */
  weights: Float64Array;
  random: Random;
  options: NetworkOptions;
}

/** The days before the first sample: less than a week says nothing about "lately". */
const MIN_CONTEXT_DAYS = 7;
/** Fewer samples than this, or fewer days with spending, are too few to learn from. */
const MIN_SAMPLES = 60;
const MIN_SPENDING_SAMPLES = 20;
/** How fast the network's sense of "a change happened" fades, in days. */
const CHANGE_MEMORY_DAYS = 28;
const CONTINUOUS = 9;
const CALENDAR = 9;
const OUTPUTS = 4;
const QUANTILES = [0.1, 0.5, 0.9] as const;

/** Running sums over the series, so any window's sum is one subtraction. */
interface Context {
  length: number;
  keys: readonly string[];
  sums: Float64Array[];
  spendDays: Float64Array[];
  totals: Float64Array;
  positive: Float64Array;
  dominant: Float64Array;
  change: LifeChange | null;
}

function prefix(values: ArrayLike<number>, map: (value: number) => number = (value) => value) {
  const sums = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index++) {
    sums[index + 1] = sums[index]! + map(values[index]!);
  }
  return sums;
}

/** A category the series has no days of reads as one that spent nothing. */
function contextOf(
  series: DailySeries,
  signals: DailySignals,
  change: LifeChange | null,
  keys: readonly string[]
): Context {
  const values = keys.map((key) => series.byCategory.get(key) ?? new Float64Array(series.length));
  return {
    length: series.length,
    keys,
    sums: values.map((days) => prefix(days)),
    spendDays: values.map((days) => prefix(days, (value) => (value > 0 ? 1 : 0))),
    totals: prefix(signals.totals),
    positive: prefix(signals.positive),
    dominant: prefix(signals.dominant),
    change,
  };
}

/** The sum of `sums`' series over the `days` days before `end`, and how many days that was. */
function windowOf(sums: Float64Array, end: number, days: number): [number, number] {
  const start = Math.max(0, end - days);
  return [sums[end]! - sums[start]!, end - start];
}

const logLevel = (sum: number, days: number) => Math.log1p(Math.max(0, sum / Math.max(1, days)));

/** What a category and the household have been doing over the days before day `end`. */
function continuousFeatures(context: Context, category: number, end: number): Float64Array {
  const sums = context.sums[category]!;
  const spendDays = context.spendDays[category]!;
  const [sum7, days7] = windowOf(sums, end, 7);
  const [sum28, days28] = windowOf(sums, end, 28);
  const [spent7] = windowOf(spendDays, end, 7);
  const [spent28] = windowOf(spendDays, end, 28);
  const [total7] = windowOf(context.totals, end, 7);
  const [total28] = windowOf(context.totals, end, 28);
  const [positive14] = windowOf(context.positive, end, 14);
  const [dominant14] = windowOf(context.dominant, end, 14);
  const sinceChange =
    context.change == null || end <= context.change.day ? null : end - context.change.day;
  return Float64Array.of(
    spent7 / Math.max(1, days7),
    spent28 / Math.max(1, days28),
    logLevel(sum28, spent28),
    logLevel(sum7, days7) - logLevel(sum28, days28),
    logLevel(sum28, days28),
    logLevel(total7, days7),
    logLevel(total28, days28),
    positive14 > 0 ? dominant14 / positive14 : 1,
    sinceChange == null ? 0 : Math.exp(-sinceChange / CHANGE_MEMORY_DAYS)
  );
}

/** The day being predicted: its weekday, and where in the month it falls, as a point on a circle. */
function calendarFeatures(date: string): Float64Array {
  const features = new Float64Array(CALENDAR);
  features[weekdayOf(date)] = 1;
  const angle = (2 * Math.PI * (Number(date.slice(8, 10)) - 1)) / 31;
  features[7] = Math.sin(angle);
  features[8] = Math.cos(angle);
  return features;
}

function inputOf(
  model: Pick<NetworkModel, "keys" | "mean" | "scale">,
  continuous: Float64Array,
  calendar: Float64Array,
  category: number
): Float64Array {
  const input = new Float64Array(CONTINUOUS + CALENDAR + model.keys.length);
  for (let index = 0; index < CONTINUOUS; index++) {
    input[index] = (continuous[index]! - model.mean[index]!) / model.scale[index]!;
  }
  input.set(calendar, CONTINUOUS);
  input[CONTINUOUS + CALENDAR + category] = 1;
  return input;
}

const softplus = (value: number) => (value > 20 ? value : Math.log1p(Math.exp(value)));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

/**
 * The network's four outputs as a chance and three ordered quantiles of the
 * log amount: the gaps between quantiles pass through softplus, so the low
 * point can never come out above the middle one.
 */
export function readOutputs(output: Float64Array): {
  chance: number;
  quantiles: [number, number, number];
} {
  const low = output[1]!;
  const middle = low + softplus(output[2]!);
  const high = middle + softplus(output[3]!);
  return { chance: sigmoid(output[0]!), quantiles: [low, middle, high] };
}

interface Sample {
  input: Float64Array;
  day: number;
  spent: boolean;
  logAmount: number;
  weight: number;
}

/**
 * The loss of one sample and its gradient with respect to the outputs: the
 * log loss of whether the day spent, plus, on a day that did, the pinball
 * loss of each quantile against the log of what it cost.
 */
export function sampleLoss(
  output: Float64Array,
  spent: boolean,
  logAmount: number
): { loss: number; gradient: Float64Array } {
  const gradient = new Float64Array(OUTPUTS);
  const chance = sigmoid(output[0]!);
  const clamped = Math.min(1 - 1e-12, Math.max(1e-12, chance));
  let loss = spent ? -Math.log(clamped) : -Math.log(1 - clamped);
  gradient[0] = chance - (spent ? 1 : 0);
  if (!spent) return { loss, gradient };

  const { quantiles } = readOutputs(output);
  const slopes = QUANTILES.map((tau, index) => {
    const residual = logAmount - quantiles[index]!;
    loss += residual >= 0 ? tau * residual : (tau - 1) * residual;
    return residual >= 0 ? -tau : 1 - tau;
  }) as [number, number, number];
  // low = o1; middle = low + softplus(o2); high = middle + softplus(o3).
  gradient[1] = slopes[0] + slopes[1] + slopes[2];
  gradient[2] = (slopes[1] + slopes[2]) * sigmoid(output[2]!);
  gradient[3] = slopes[2] * sigmoid(output[3]!);
  return { loss, gradient };
}

function weightedLoss(mlp: Mlp, samples: readonly Sample[]): number {
  let loss = 0;
  let weight = 0;
  for (const sample of samples) {
    const output = forward(mlp, sample.input).at(-1)!;
    loss += sample.weight * sampleLoss(output, sample.spent, sample.logAmount).loss;
    weight += sample.weight;
  }
  return weight === 0 ? 0 : loss / weight;
}

function* runEpochs(
  mlp: Mlp,
  samples: readonly Sample[],
  epochs: number,
  random: Random,
  options: NetworkOptions,
  afterEpoch?: (epoch: number) => boolean
): Generator<void, void> {
  const adam = createAdam(mlp);
  const order = samples.map((_, index) => index);
  for (let epoch = 1; epoch <= epochs; epoch++) {
    // Fisher–Yates with the seeded draw, so a retrain gives the same network.
    for (let index = order.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap]!, order[index]!];
    }
    for (let start = 0; start < order.length; start += options.batchSize) {
      const batch = order.slice(start, start + options.batchSize);
      const gradients = zeroGradients(mlp);
      let batchWeight = 0;
      for (const index of batch) batchWeight += samples[index]!.weight;
      if (batchWeight <= 0) continue;
      for (const index of batch) {
        const sample = samples[index]!;
        const activations = forward(mlp, sample.input);
        const { gradient } = sampleLoss(activations.at(-1)!, sample.spent, sample.logAmount);
        backward(mlp, activations, gradient, gradients, sample.weight / batchWeight);
      }
      adamStep(mlp, gradients, adam, options);
    }
    yield;
    if (afterEpoch?.(epoch) === true) return;
  }
}

/**
 * Trains the network on every day of the series that has a week before it,
 * in every category, each sample counting as much as its day does. The latest
 * `validationDays` are held out first to find when more training stops
 * helping; the network is then trained afresh on everything for that long.
 *
 * A generator: it yields after every epoch, so a caller on a server can let
 * other work run in between. Returns null when there is too little to learn.
 */
export function* trainNetwork(input: NetworkTrainingInput): Generator<void, NetworkModel | null> {
  const { series, signals, change, weights, random, options } = input;
  const keys = [...series.byCategory.keys()].sort();
  if (keys.length === 0) return null;
  const context = contextOf(series, signals, change, keys);

  const raw: {
    category: number;
    continuous: Float64Array;
    calendar: Float64Array;
    sample: Omit<Sample, "input">;
  }[] = [];
  const calendars: Float64Array[] = [];
  for (let day = MIN_CONTEXT_DAYS; day < series.length; day++) {
    calendars[day] = calendarFeatures(addCivilDays(series.start, day));
  }
  for (let category = 0; category < keys.length; category++) {
    const values = series.byCategory.get(keys[category]!)!;
    for (let day = MIN_CONTEXT_DAYS; day < series.length; day++) {
      const value = values[day]!;
      raw.push({
        category,
        continuous: continuousFeatures(context, category, day),
        calendar: calendars[day]!,
        sample: {
          day,
          spent: value > 0,
          logAmount: value > 0 ? Math.log1p(value) : 0,
          weight: weights[day]!,
        },
      });
    }
  }
  if (
    raw.length < MIN_SAMPLES ||
    raw.filter((item) => item.sample.spent).length < MIN_SPENDING_SAMPLES
  ) {
    return null;
  }

  const mean = new Float64Array(CONTINUOUS);
  const scale = new Float64Array(CONTINUOUS);
  for (const item of raw) {
    for (let index = 0; index < CONTINUOUS; index++) {
      mean[index] = mean[index]! + item.continuous[index]! / raw.length;
    }
  }
  for (const item of raw) {
    for (let index = 0; index < CONTINUOUS; index++) {
      scale[index] = scale[index]! + (item.continuous[index]! - mean[index]!) ** 2 / raw.length;
    }
  }
  for (let index = 0; index < CONTINUOUS; index++) {
    // A feature that never moves is left as it is rather than divided by nothing.
    scale[index] = Math.sqrt(scale[index]!) || 1;
  }

  const standardized = { keys, mean, scale };
  const samples: Sample[] = raw.map((item) => ({
    ...item.sample,
    input: inputOf(standardized, item.continuous, item.calendar, item.category),
  }));
  const sizes = [CONTINUOUS + CALENDAR + keys.length, ...options.hidden, OUTPUTS];
  // Both runs start from the same weights and see the samples in the same order.
  const seed = Math.floor(random() * 2 ** 32);
  const seeded = () => seededRandom(seed);

  const cut = series.length - options.validationDays;
  const training = samples.filter((sample) => sample.day < cut);
  const validation = samples.filter((sample) => sample.day >= cut);
  let epochs = options.maxEpochs;
  if (training.length >= MIN_SAMPLES && validation.some((sample) => sample.weight > 0)) {
    const draw = seeded();
    const mlp = createMlp(sizes, draw);
    let best = Number.POSITIVE_INFINITY;
    let bestEpoch = 1;
    yield* runEpochs(mlp, training, options.maxEpochs, draw, options, (epoch) => {
      const loss = weightedLoss(mlp, validation);
      if (loss < best - 1e-6) {
        best = loss;
        bestEpoch = epoch;
      }
      return epoch - bestEpoch >= options.patience;
    });
    epochs = bestEpoch;
  }

  const draw = seeded();
  const mlp = createMlp(sizes, draw);
  yield* runEpochs(mlp, samples, epochs, draw, options);
  return { mlp: cloneMlp(mlp), ...standardized };
}

/**
 * The network's view of the `days` days after the series ends, as one day
 * model per category it was trained on. Every day is read from where things
 * stand at the end of the series: the network predicts from what is known
 * now, not from days it would have to imagine first.
 */
export function networkDayModels(
  model: NetworkModel,
  input: { series: DailySeries; signals: DailySignals; change: LifeChange | null; days: number }
): Map<string, DayModel> {
  const { series, signals, change, days } = input;
  const keys = model.keys.filter((key) => series.byCategory.has(key));
  const context = contextOf(series, signals, change, model.keys);
  const models = new Map<string, DayModel>();
  const calendars = Array.from({ length: days }, (_, index) =>
    calendarFeatures(addCivilDays(series.start, series.length + index + 1))
  );
  for (const key of keys) {
    const category = model.keys.indexOf(key);
    const continuous = continuousFeatures(context, category, series.length);
    const outputs = calendars.map((calendar) =>
      readOutputs(forward(model.mlp, inputOf(model, continuous, calendar, category)).at(-1)!)
    );
    models.set(key, {
      chance: (day) => outputs[day - 1]!.chance,
      amount: (day, draw) =>
        Math.expm1(Math.max(0, logAmountAt(outputs[day - 1]!.quantiles, draw))),
    });
  }
  return models;
}

/**
 * The log amount a share `draw` of days falls below, read off a line through
 * the three quantiles and carried on past them at the slopes of their ends.
 */
export function logAmountAt(quantiles: readonly [number, number, number], draw: number): number {
  const [low, middle, high] = quantiles;
  if (draw <= 0.5) return middle + ((draw - 0.5) / 0.4) * (middle - low);
  return middle + ((draw - 0.5) / 0.4) * (high - middle);
}
