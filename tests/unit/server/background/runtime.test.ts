import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  runOnce: vi.fn(),
  drain: vi.fn(),
}));

const scheduler = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
}));

vi.mock("@/server/background/worker", () => ({ createBackgroundWorker: () => worker }));
vi.mock("@/server/background/scheduler", () => ({ createDailyScheduler: () => scheduler }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const RUNTIME_KEY = Symbol.for("cashier.background.runtime");

describe("startBackgroundRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as Record<symbol, unknown>)[RUNTIME_KEY];
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  it("starts one worker per process however often it is called", async () => {
    const { startBackgroundRuntime } = await import("@/server/background/runtime");

    startBackgroundRuntime();
    startBackgroundRuntime();

    expect(worker.start).toHaveBeenCalledTimes(1);
    expect(scheduler.start).toHaveBeenCalledTimes(1);
  });

  it("leaves signals to Next unless it was told to hand them over", async () => {
    vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "");
    const before = process.listenerCount("SIGTERM");
    const { startBackgroundRuntime } = await import("@/server/background/runtime");

    startBackgroundRuntime();

    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("stops the worker with a grace period on SIGTERM, then exits", async () => {
    vi.stubEnv("NEXT_MANUAL_SIG_HANDLE", "true");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const { startBackgroundRuntime } = await import("@/server/background/runtime");

    startBackgroundRuntime();
    process.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(worker.stop).toHaveBeenCalledWith({ graceMs: 20_000 });
    expect(scheduler.stop).toHaveBeenCalledWith({ graceMs: 20_000 });
    exit.mockRestore();
  });
});
