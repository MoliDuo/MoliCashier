import { describe, expect, it } from "vitest";
import { mostLikelyRunLengths } from "@/modules/forecast/domain/changepoints";

const PRIOR = [{ mean: 5, variance: 0.05 }];
/** A small wobble that repeats, so the tests need no random numbers. */
const wobble = (step: number) => [0.1, -0.15, 0.05, 0.2, -0.1][step % 5]!;

describe("mostLikelyRunLengths", () => {
  it("counts one regime for as long as nothing changes", () => {
    const steps = Array.from({ length: 20 }, (_, step) => [5 + wobble(step)]);

    expect(mostLikelyRunLengths(steps, PRIOR, 1 / 16)).toEqual(
      Array.from({ length: 20 }, (_, step) => step + 1)
    );
  });

  it("starts a new regime where the level moves and stays", () => {
    const steps = Array.from({ length: 20 }, (_, step) => [(step < 12 ? 5 : 3) + wobble(step)]);

    const lengths = mostLikelyRunLengths(steps, PRIOR, 1 / 16);

    // The last step belongs to a regime begun at step 12.
    expect(lengths.at(-1)).toBe(8);
    expect(lengths[11]).toBe(12);
  });

  it("reads a step with a missing measurement from the others alone", () => {
    const priors = [PRIOR[0]!, { mean: 0.9, variance: 0.01 }];
    const steps = Array.from({ length: 12 }, (_, step) => [
      5 + wobble(step),
      step % 4 === 0 ? Number.NaN : 0.9,
    ]);

    expect(mostLikelyRunLengths(steps, priors, 1 / 16).at(-1)).toBe(12);
  });
});
