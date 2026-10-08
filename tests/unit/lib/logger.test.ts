import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pinoMock } = vi.hoisted(() => ({
  pinoMock: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("pino", () => ({
  default: Object.assign(pinoMock, { stdSerializers: { err: vi.fn() } }),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("logger", () => {
  it("does not require startup-only env when imported from a client-like module graph", async () => {
    process.env = {
      NODE_ENV: "development",
    };

    const loggerModule = await import("@/lib/logger");

    expect(loggerModule.logger).toBe(pinoMock.mock.results[0]?.value);
    expect(pinoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
      })
    );
  });

  it("trims configured log level and falls back for blank values", async () => {
    process.env = {
      NODE_ENV: "production",
      LOG_LEVEL: " warn ",
    };

    await import("@/lib/logger");

    expect(pinoMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: "warn",
      })
    );

    vi.resetModules();
    pinoMock.mockClear();
    process.env = {
      NODE_ENV: "production",
      LOG_LEVEL: " ",
    };

    await import("@/lib/logger");

    expect(pinoMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: "info",
      })
    );
  });
});
