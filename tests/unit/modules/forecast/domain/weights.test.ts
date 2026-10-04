import { describe, expect, it } from "vitest";
import { recencyWeights } from "@/modules/forecast/domain/weights";

describe("recencyWeights", () => {
  it("halves a day's weight for every half-life it is older than the last day", () => {
    const weights = recencyWeights(61, 30);

    expect(weights[60]).toBe(1);
    expect(weights[30]).toBeCloseTo(0.5);
    expect(weights[0]).toBeCloseTo(0.25);
  });

  it("counts every day the same without a half-life", () => {
    expect(Array.from(recencyWeights(3, null))).toEqual([1, 1, 1]);
    expect(recencyWeights(0, 30)).toHaveLength(0);
  });
});
