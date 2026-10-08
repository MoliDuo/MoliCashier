import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { classifyFailure, RETRY_AFTER_MAX_MS, retryDelayMs } from "@/lib/background/retry";
import { ProcessingFailure } from "@/modules/source-document/domain/parse/contracts";

class WrappedFailure extends Error {}

/** An error shaped like node-postgres's, which carries the SQLSTATE as `code`. */
function pgError(code: string): Error {
  return Object.assign(new Error("database said no"), { code });
}

describe("background failure classification", () => {
  it.each(["ai_rate_limited", "ai_provider_unavailable", "ai_timeout", "ai_output_truncated"])(
    "treats %s as transient",
    (code) => {
      expect(classifyFailure(new AppError("x", code))).toMatchObject({ kind: "transient", code });
    }
  );

  it("finds the provider's error behind a wrapper and keeps its retry hint", () => {
    const provider = new AppError("limited", "ai_rate_limited", 503, { retryAfterMs: 7_000 });
    expect(classifyFailure(new WrappedFailure("parse failed", { cause: provider }))).toEqual({
      kind: "transient",
      code: "ai_rate_limited",
      retryAfterMs: 7_000,
    });
  });

  it("treats an object store that failed or timed out as transient, but not one that refused", () => {
    const outage = new AppError("down", "S3_DOWNLOAD_FAILED", 503, { httpStatusCode: 503 });
    const timeout = new AppError("timeout", "S3_DOWNLOAD_FAILED", 503);
    const forbidden = new AppError("no", "S3_DOWNLOAD_FAILED", 503, { httpStatusCode: 403 });
    // The way evidence loading wraps it: a storage failure around an image load failure.
    const wrapped = new ProcessingFailure("storage_failure", "x", {
      cause: Object.assign(new AppError("load", "IMAGE_LOAD_FAILED"), { cause: outage }),
    });

    expect(classifyFailure(wrapped)).toMatchObject({
      kind: "transient",
      code: "S3_DOWNLOAD_FAILED",
    });
    expect(classifyFailure(timeout)).toMatchObject({ kind: "transient" });
    expect(classifyFailure(forbidden)).toMatchObject({ kind: "permanent" });
  });

  it.each(["08006", "08001", "57P01", "53300", "40001", "40P01"])(
    "treats PostgreSQL SQLSTATE %s as transient",
    (code) => {
      expect(classifyFailure(new WrappedFailure("x", { cause: pgError(code) }))).toMatchObject({
        kind: "transient",
        code,
      });
    }
  );

  it("does not treat other SQLSTATEs as transient", () => {
    expect(classifyFailure(pgError("23505"))).toMatchObject({ kind: "permanent" });
  });

  it("treats a pool with no free connection and a dropped connection as transient", () => {
    expect(classifyFailure(new Error("timeout exceeded when trying to connect"))).toMatchObject({
      kind: "transient",
      code: "pool_connect_timeout",
    });
    expect(classifyFailure(pgError("ECONNRESET"))).toMatchObject({ kind: "transient" });
  });

  it("treats a parse that ran past its deadline as transient, and other parse failures not", () => {
    expect(classifyFailure(new ProcessingFailure("processing_timeout", "too slow"))).toMatchObject({
      kind: "transient",
      code: "processing_timeout",
    });
    expect(
      classifyFailure(new ProcessingFailure("ai_provider_unavailable", "x", { cause: new Error() }))
    ).toMatchObject({ kind: "permanent" });
  });

  it("treats an invalid provider configuration as needing an operator", () => {
    const invalid = new AppError("bad key", "ai_configuration_invalid", 500);
    expect(classifyFailure(new WrappedFailure("x", { cause: invalid }))).toMatchObject({
      kind: "configuration",
    });
  });

  it("treats anything else as permanent", () => {
    expect(classifyFailure(new Error("boom"))).toEqual({
      kind: "permanent",
      code: null,
      retryAfterMs: null,
    });
    expect(classifyFailure(new AppError("gone", "FILE_NOT_FOUND", 404))).toMatchObject({
      kind: "permanent",
      code: "FILE_NOT_FOUND",
    });
  });
});

describe("background retry delay", () => {
  it("draws a random delay up to a ceiling that grows by four up to a minute", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, null, () => 1))).toEqual([
      2_000, 8_000, 32_000, 60_000, 60_000,
    ]);
    expect(retryDelayMs(3, null, () => 0.25)).toBe(8_000);
    expect(retryDelayMs(3, null, () => 0)).toBe(0);
  });

  it("spreads work that failed together", () => {
    const delays = new Set(Array.from({ length: 20 }, () => retryDelayMs(3)));
    expect(delays.size).toBeGreaterThan(1);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(32_000);
    }
  });

  it("waits at least as long as the provider asked, up to fifteen minutes", () => {
    expect(retryDelayMs(1, 45_000, () => 1)).toBe(45_000);
    expect(retryDelayMs(3, 1_000, () => 1)).toBe(32_000);
    expect(retryDelayMs(1, 6 * 60 * 60_000, () => 1)).toBe(RETRY_AFTER_MAX_MS);
  });
});
