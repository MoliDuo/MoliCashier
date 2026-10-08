import { describe, expect, it } from "vitest";
import { fitImageDimensions } from "@/lib/image-dimensions";

describe("fitImageDimensions", () => {
  it("fits landscape images inside non-square bounds", () => {
    expect(fitImageDimensions(2000, 1000, 1200, 400)).toEqual({
      width: 800,
      height: 400,
    });
  });

  it("fits portrait images inside non-square bounds", () => {
    expect(fitImageDimensions(1000, 2000, 400, 1200)).toEqual({
      width: 400,
      height: 800,
    });
  });

  it("also keeps within a pixel budget, so a long screenshot shrinks evenly", () => {
    const fitted = fitImageDimensions(1440, 20_000, 1440, 16_383, 16_000_000);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(16_000_000);
    expect(fitted.height).toBeLessThanOrEqual(16_383);
    expect(fitted.height / fitted.width).toBeCloseTo(20_000 / 1440, 1);
  });

  it("does not upscale images", () => {
    expect(fitImageDimensions(200, 100, 1200, 400)).toEqual({
      width: 200,
      height: 100,
    });
  });
});
