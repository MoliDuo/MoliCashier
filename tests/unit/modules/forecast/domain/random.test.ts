import { describe, expect, it } from "vitest";
import { seededRandom, seedOf } from "@/modules/forecast/domain/random";

describe("seededRandom", () => {
  it("repeats its draws for a seed, stays in [0, 1), and differs between seeds", () => {
    const draws = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 1000 }, () => random());
    };

    const first = draws(seedOf("2026-10-04:all:month:0"));
    expect(draws(seedOf("2026-10-04:all:month:0"))).toEqual(first);
    expect(draws(seedOf("2026-10-05:all:month:0"))).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    // Roughly uniform: the mean of a thousand draws sits near a half.
    expect(first.reduce((sum, value) => sum + value, 0) / first.length).toBeCloseTo(0.5, 1);
  });
});
