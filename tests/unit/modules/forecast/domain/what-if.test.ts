import { describe, expect, it } from "vitest";
import { whatIfOutcome } from "@/modules/forecast/domain/what-if";

describe("whatIfOutcome", () => {
  it("scales a category's paths and adds every path back up", () => {
    const categories = [
      { samples: [100, 200, 300, 400, 500], factor: 1 },
      { samples: [50, 50, 50, 50, 50], factor: 1 },
    ];

    const asIs = whatIfOutcome({ spent: 1000, categories, previousTotal: 1300 })!;
    expect(asIs.p50).toBe(1350);
    expect(asIs.exceedPrevious).toBe(0.6);

    const less = whatIfOutcome({
      spent: 1000,
      categories: [{ ...categories[0]!, factor: 0.5 }, categories[1]!],
      previousTotal: 1300,
    })!;
    expect(less.p50).toBe(1200);
    expect(less.p10).toBeLessThan(less.p50);
    expect(less.p90).toBeGreaterThan(less.p50);
    expect(less.exceedPrevious).toBe(0);
  });

  it("has nothing to say without paths, and leaves the comparison out without a previous total", () => {
    expect(whatIfOutcome({ spent: 10, categories: [], previousTotal: null })).toBeNull();
    expect(
      whatIfOutcome({ spent: 10, categories: [{ samples: [1], factor: 1 }], previousTotal: null })!
        .exceedPrevious
    ).toBeNull();
  });
});
