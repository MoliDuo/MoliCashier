import { describe, expect, it, vi } from "vitest";
import { encodeWithinBudget } from "@/lib/image-encoding";

/** An encoder whose output shrinks with the quality, as a JPEG encoder's does. */
function encoder(bytesAtFullQuality: number) {
  return vi.fn(async (quality: number) => new Blob([new Uint8Array(bytesAtFullQuality * quality)]));
}

describe("encodeWithinBudget", () => {
  it("keeps the first encoding when it fits", async () => {
    const encode = encoder(1000);

    const blob = await encodeWithinBudget(encode, 0.8, 1000);

    expect(blob.size).toBe(800);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("lowers the quality step by step until the image fits", async () => {
    const encode = encoder(1000);

    const blob = await encodeWithinBudget(encode, 0.8, 600);

    const qualities = encode.mock.calls.map(([quality]) => quality);
    expect(qualities).toHaveLength(3);
    expect(qualities[1]).toBeCloseTo(0.65);
    expect(qualities[2]).toBe(0.5);
    expect(blob.size).toBeLessThanOrEqual(600);
  });

  it("stops at the quality floor and returns what it has", async () => {
    const encode = encoder(1000);

    const blob = await encodeWithinBudget(encode, 0.8, 100);

    expect(encode.mock.calls.at(-1)?.[0]).toBe(0.5);
    expect(blob.size).toBe(500);
  });
});
