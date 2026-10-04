import { describe, expect, it } from "vitest";
import type { DayModel } from "@/modules/forecast/domain/day-model";
import { seededRandom } from "@/modules/forecast/domain/random";
import { quantile, quantilesOf, simulate } from "@/modules/forecast/domain/simulate";

const always = (amount: number): DayModel => ({ chance: () => 1, amount: () => amount });
const coinFlip = (amount: number): DayModel => ({ chance: () => 0.5, amount: () => amount });

describe("simulate", () => {
  it("adds up each path day by day, per category and all together", () => {
    const result = simulate(
      new Map([
        ["rent", always(100)],
        ["coffee", always(5)],
      ]),
      { days: 3, paths: 4, random: seededRandom(1) }
    );

    expect(Array.from(result.byCategory.get("rent")!)).toEqual([300, 300, 300, 300]);
    expect(Array.from(result.byCategory.get("coffee")!)).toEqual([15, 15, 15, 15]);
    expect(result.running.map((column) => column[0])).toEqual([105, 210, 315]);
  });

  it("spreads the outcomes of a category that spends on some days", () => {
    const result = simulate(new Map([["coffee", coinFlip(10)]]), {
      days: 30,
      paths: 2000,
      random: seededRandom(3),
    });
    const outcome = quantilesOf(result.byCategory.get("coffee")!);

    // Fifteen days of coffee in the middle, give or take a few.
    expect(outcome.p50).toBeCloseTo(150, -1);
    expect(outcome.p10).toBeLessThan(outcome.p50);
    expect(outcome.p90).toBeGreaterThan(outcome.p50);
  });
});

describe("quantile", () => {
  it("interpolates between neighbouring values and shifts by the offset", () => {
    expect(quantile(new Float64Array([0, 10]), 0.5)).toBe(5);
    expect(quantile(new Float64Array([]), 0.5)).toBe(0);
    expect(quantilesOf(new Float64Array([30, 10, 20]), 100)).toEqual({
      p10: 112,
      p50: 120,
      p90: 128,
    });
  });
});
