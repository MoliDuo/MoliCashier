import type { Random } from "../random";

/**
 * A small fully connected network: tanh hidden layers and a linear output.
 * Layer `l` maps `sizes[l]` inputs to `sizes[l + 1]` outputs; its weights are
 * row-major, one row per output.
 *
 * It is written out by hand rather than taken from a library: the networks
 * here have a few hundred weights, train in about a second, and a few dozen
 * lines that can be read and tested beat a dependency the size of the app.
 */
export interface Mlp {
  sizes: readonly number[];
  weights: Float64Array[];
  biases: Float64Array[];
}

/** The outputs of every layer for one input, the input first: what a backward pass needs. */
export type Activations = Float64Array[];

/** Weights drawn at the scale that keeps a tanh layer's outputs from saturating (Glorot). */
export function createMlp(sizes: readonly number[], random: Random): Mlp {
  const weights: Float64Array[] = [];
  const biases: Float64Array[] = [];
  for (let layer = 0; layer < sizes.length - 1; layer++) {
    const inputs = sizes[layer]!;
    const outputs = sizes[layer + 1]!;
    const scale = Math.sqrt(2 / (inputs + outputs));
    weights.push(Float64Array.from({ length: inputs * outputs }, () => normal(random) * scale));
    biases.push(new Float64Array(outputs));
  }
  return { sizes, weights, biases };
}

/** A standard normal draw (Box–Muller). */
function normal(random: Random): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function forward(mlp: Mlp, input: Float64Array): Activations {
  const activations: Activations = [input];
  const last = mlp.weights.length - 1;
  for (let layer = 0; layer <= last; layer++) {
    const previous = activations[layer]!;
    const weights = mlp.weights[layer]!;
    const biases = mlp.biases[layer]!;
    const outputs = biases.length;
    const inputs = previous.length;
    const next = new Float64Array(outputs);
    for (let output = 0; output < outputs; output++) {
      let sum = biases[output]!;
      const row = output * inputs;
      for (let index = 0; index < inputs; index++) sum += weights[row + index]! * previous[index]!;
      next[output] = layer === last ? sum : Math.tanh(sum);
    }
    activations.push(next);
  }
  return activations;
}

/** Zeroed arrays shaped like the network's weights and biases, to add gradients into. */
export function zeroGradients(mlp: Mlp): Pick<Mlp, "weights" | "biases"> {
  return {
    weights: mlp.weights.map((layer) => new Float64Array(layer.length)),
    biases: mlp.biases.map((layer) => new Float64Array(layer.length)),
  };
}

/**
 * Adds to `gradients` the gradient of a loss with respect to every weight,
 * given the loss's gradient with respect to the outputs of the forward pass
 * that produced `activations`, scaled by `scale`.
 */
export function backward(
  mlp: Mlp,
  activations: Activations,
  outputGradient: Float64Array,
  gradients: Pick<Mlp, "weights" | "biases">,
  scale = 1
): void {
  let delta = Float64Array.from(outputGradient, (value) => value * scale);
  for (let layer = mlp.weights.length - 1; layer >= 0; layer--) {
    const input = activations[layer]!;
    const weights = mlp.weights[layer]!;
    const weightGradients = gradients.weights[layer]!;
    const biasGradients = gradients.biases[layer]!;
    const inputs = input.length;
    const previousDelta = new Float64Array(inputs);
    for (let output = 0; output < delta.length; output++) {
      const outputDelta = delta[output]!;
      if (outputDelta === 0) continue;
      biasGradients[output] = biasGradients[output]! + outputDelta;
      const row = output * inputs;
      for (let index = 0; index < inputs; index++) {
        weightGradients[row + index] = weightGradients[row + index]! + outputDelta * input[index]!;
        previousDelta[index] = previousDelta[index]! + outputDelta * weights[row + index]!;
      }
    }
    if (layer > 0) {
      // Through the tanh that produced this layer's input: d tanh = 1 − tanh².
      for (let index = 0; index < inputs; index++) {
        const value = input[index]!;
        previousDelta[index] = previousDelta[index]! * (1 - value * value);
      }
    }
    delta = previousDelta;
  }
}

export interface AdamState {
  step: number;
  first: Pick<Mlp, "weights" | "biases">;
  second: Pick<Mlp, "weights" | "biases">;
}

export function createAdam(mlp: Mlp): AdamState {
  return { step: 0, first: zeroGradients(mlp), second: zeroGradients(mlp) };
}

const BETA1 = 0.9;
const BETA2 = 0.999;
const EPSILON = 1e-8;

/**
 * One Adam step against `gradients`, with L2 shrinkage of the weights (not the
 * biases): with a few thousand samples a network this size would otherwise
 * learn the noise of individual days.
 */
export function adamStep(
  mlp: Mlp,
  gradients: Pick<Mlp, "weights" | "biases">,
  state: AdamState,
  options: { learningRate: number; l2: number }
): void {
  state.step++;
  const correction1 = 1 - Math.pow(BETA1, state.step);
  const correction2 = 1 - Math.pow(BETA2, state.step);
  const update = (
    values: Float64Array,
    grads: Float64Array,
    first: Float64Array,
    second: Float64Array,
    l2: number
  ) => {
    for (let index = 0; index < values.length; index++) {
      const gradient = grads[index]! + l2 * values[index]!;
      first[index] = BETA1 * first[index]! + (1 - BETA1) * gradient;
      second[index] = BETA2 * second[index]! + (1 - BETA2) * gradient * gradient;
      values[index] =
        values[index]! -
        (options.learningRate * (first[index]! / correction1)) /
          (Math.sqrt(second[index]! / correction2) + EPSILON);
    }
  };
  for (let layer = 0; layer < mlp.weights.length; layer++) {
    update(
      mlp.weights[layer]!,
      gradients.weights[layer]!,
      state.first.weights[layer]!,
      state.second.weights[layer]!,
      options.l2
    );
    update(
      mlp.biases[layer]!,
      gradients.biases[layer]!,
      state.first.biases[layer]!,
      state.second.biases[layer]!,
      0
    );
  }
}

export function cloneMlp(mlp: Mlp): Mlp {
  return {
    sizes: mlp.sizes,
    weights: mlp.weights.map((layer) => Float64Array.from(layer)),
    biases: mlp.biases.map((layer) => Float64Array.from(layer)),
  };
}
