import { describe, expect, it } from "vitest";
import { RateLimitedError } from "@/lib/errors";
import { RequestLimiter, takeSourceDocumentCreation } from "@/server/api-v1/rate-limit";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function limiter(maxKeys?: number) {
  return new RequestLimiter(
    [
      { capacity: 30, periodMs: MINUTE_MS },
      { capacity: 300, periodMs: DAY_MS },
    ],
    maxKeys
  );
}

describe("RequestLimiter", () => {
  it("allows a burst up to the per-minute allowance, then says when to come back", () => {
    const limits = limiter();
    for (let i = 0; i < 30; i++) expect(limits.take("key", 0)).toBe(0);

    // One token refills every two seconds at 30 a minute.
    expect(limits.take("key", 0)).toBe(2);
    expect(limits.take("key", 1_999)).toBe(1);
    expect(limits.take("key", 2_000)).toBe(0);
    expect(limits.take("key", 2_000)).toBe(2);
  });

  it("holds a steady caller to the daily allowance", () => {
    const limits = limiter();
    // Two seconds apart, the per-minute bucket never runs dry.
    for (let i = 0; i < 300; i++) expect(limits.take("key", i * 2_000)).toBe(0);

    // Over those ten minutes the daily bucket refilled about two tokens
    // (600 s at 300 a day); once they are spent it refuses, for less than the
    // 288 s one token takes to refill.
    const now = 300 * 2_000;
    expect(limits.take("key", now)).toBe(0);
    expect(limits.take("key", now)).toBe(0);
    const refused = limits.take("key", now);
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThanOrEqual(DAY_MS / 300 / 1000);
  });

  it("keeps each caller's allowance apart", () => {
    const limits = limiter();
    for (let i = 0; i < 30; i++) limits.take("first", 0);

    expect(limits.take("first", 0)).toBeGreaterThan(0);
    expect(limits.take("second", 0)).toBe(0);
  });

  it("remembers a bounded number of callers, forgetting the one seen longest ago", () => {
    const limits = limiter(2);
    for (let i = 0; i < 30; i++) limits.take("first", 0);
    limits.take("second", 0);
    limits.take("third", 0);

    expect(limits.trackedKeys).toBe(2);
    // "first" was dropped, so it starts again with a full allowance.
    expect(limits.take("first", 0)).toBe(0);
  });
});

describe("takeSourceDocumentCreation", () => {
  it("refuses the request past the allowance with a 429 that says when to retry", () => {
    const credentialId = crypto.randomUUID();
    for (let i = 0; i < 30; i++) takeSourceDocumentCreation(credentialId, 0);

    let error: unknown;
    try {
      takeSourceDocumentCreation(credentialId, 0);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ statusCode: 429, retryAfterSeconds: 2 });
  });
});
