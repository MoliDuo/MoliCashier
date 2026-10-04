import { describe, expect, it } from "vitest";
import {
  adamStep,
  backward,
  cloneMlp,
  createAdam,
  createMlp,
  forward,
  zeroGradients,
  type Mlp,
} from "@/modules/forecast/domain/nn/mlp";
import { seededRandom } from "@/modules/forecast/domain/random";

/** Half the squared distance of the outputs from `target`. */
function loss(mlp: Mlp, input: Float64Array, target: readonly number[]): number {
  const output = forward(mlp, input).at(-1)!;
  return output.reduce((sum, value, index) => sum + 0.5 * (value - target[index]!) ** 2, 0);
}

describe("mlp", () => {
  it("computes the same gradients as nudging each weight", () => {
    const mlp = createMlp([3, 4, 2], seededRandom(1));
    const input = Float64Array.of(0.3, -1.2, 0.8);
    const target = [0.5, -0.25];
    const activations = forward(mlp, input);
    const output = activations.at(-1)!;
    const gradients = zeroGradients(mlp);
    backward(
      mlp,
      activations,
      Float64Array.from(output, (value, index) => value - target[index]!),
      gradients
    );

    const step = 1e-6;
    for (let layer = 0; layer < mlp.weights.length; layer++) {
      for (const [values, analytic] of [
        [mlp.weights[layer]!, gradients.weights[layer]!],
        [mlp.biases[layer]!, gradients.biases[layer]!],
      ] as const) {
        for (let index = 0; index < values.length; index++) {
          const original = values[index]!;
          values[index] = original + step;
          const up = loss(mlp, input, target);
          values[index] = original - step;
          const down = loss(mlp, input, target);
          values[index] = original;
          expect(analytic[index]).toBeCloseTo((up - down) / (2 * step), 6);
        }
      }
    }
  });

  it("learns a simple function with Adam, and starts from the same weights for the same seed", () => {
    const random = seededRandom(2);
    const mlp = createMlp([1, 8, 1], random);
    expect(createMlp([1, 8, 1], seededRandom(2))).toEqual(createMlp([1, 8, 1], seededRandom(2)));
    const points = Array.from({ length: 32 }, (_, index) => {
      const x = index / 16 - 1;
      return { input: Float64Array.of(x), target: [Math.sin(2 * x)] };
    });
    const total = () =>
      points.reduce((sum, point) => sum + loss(mlp, point.input, point.target), 0);
    const before = total();
    const untouched = cloneMlp(mlp);

    const adam = createAdam(mlp);
    for (let epoch = 0; epoch < 400; epoch++) {
      const gradients = zeroGradients(mlp);
      for (const point of points) {
        const activations = forward(mlp, point.input);
        const output = activations.at(-1)!;
        backward(
          mlp,
          activations,
          Float64Array.of(output[0]! - point.target[0]!),
          gradients,
          1 / 32
        );
      }
      adamStep(mlp, gradients, adam, { learningRate: 0.02, l2: 0 });
    }

    expect(total()).toBeLessThan(before / 10);
    // The clone kept the weights it was taken with.
    expect(loss(untouched, points[0]!.input, points[0]!.target)).not.toBe(
      loss(mlp, points[0]!.input, points[0]!.target)
    );
  });

  it("shrinks the weights but not the biases under L2 with no gradient", () => {
    const mlp = createMlp([2, 2], seededRandom(3));
    mlp.biases[0]!.fill(1);
    const before = Math.abs(mlp.weights[0]![0]!);
    const adam = createAdam(mlp);
    for (let step = 0; step < 50; step++) {
      adamStep(mlp, zeroGradients(mlp), adam, { learningRate: 0.01, l2: 1 });
    }
    expect(Math.abs(mlp.weights[0]![0]!)).toBeLessThan(before);
    expect(Array.from(mlp.biases[0]!)).toEqual([1, 1]);
  });
});
