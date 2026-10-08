import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const validateStartupEnv = vi.fn(() => ({
  DATABASE_URL: "file:./data/sqlite.db",
  S3_BUCKET: "cashier-images",
}));

vi.mock("@/lib/logger", () => ({
  logger,
}));

const startupEnvWarnings = vi.fn((): string[] => []);

vi.mock("@/lib/env/startup", () => ({
  validateStartupEnv,
  startupEnvWarnings,
}));

const startBackgroundRuntime = vi.fn();
vi.mock("@/server/background/runtime", () => ({ startBackgroundRuntime }));

describe("instrumentation.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_RUNTIME = "nodejs";
  });

  it("does not start the background worker under test", async () => {
    const { register } = await import("@/instrumentation");

    await register();

    expect(validateStartupEnv).toHaveBeenCalledTimes(1);
    expect(startBackgroundRuntime).not.toHaveBeenCalled();
    // The ledger comes from `ledger:create`; boot prints no codes or links.
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("starts the background worker outside of tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { register } = await import("@/instrumentation");

    await register();

    expect(startBackgroundRuntime).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("logs what the startup settings should not be, and still starts", async () => {
    startupEnvWarnings.mockReturnValueOnce(["AUTH_SECRET is shorter than 32 characters"]);
    const { register } = await import("@/instrumentation");

    await register();

    expect(logger.warn).toHaveBeenCalledWith("AUTH_SECRET is shorter than 32 characters");
  });

  it("rethrows startup env validation failures", async () => {
    validateStartupEnv.mockImplementationOnce(() => {
      throw new Error("invalid env");
    });

    const { register } = await import("@/instrumentation");

    await expect(register()).rejects.toThrow("invalid env");
    expect(logger.error).toHaveBeenCalled();
    expect(startBackgroundRuntime).not.toHaveBeenCalled();
  });
});
