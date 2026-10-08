import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const lock = vi.hoisted(() => ({
  withAdvisoryLock: vi.fn(async (_key: number, work: () => Promise<unknown>) => ({
    ran: true as const,
    value: await work(),
  })),
}));

vi.mock("@/lib/logger", () => ({ logger }));
vi.mock("@/lib/db/advisory-lock", () => lock);
vi.mock("@/server/maintenance/daily", () => ({ runDailyMaintenance: vi.fn() }));

import { createDailyScheduler, nextDailyRun } from "@/server/background/scheduler";

const DAY_MS = 24 * 60 * 60 * 1000;
const done = { expired_records: "done" } as never;

describe("nextDailyRun", () => {
  it("picks today's slot while it is still ahead", () => {
    expect(nextDailyRun(new Date("2030-01-01T10:00:00Z"), 18).toISOString()).toBe(
      "2030-01-01T18:00:00.000Z"
    );
  });

  it("picks tomorrow's slot once today's has started", () => {
    expect(nextDailyRun(new Date("2030-01-01T18:00:00Z"), 18).toISOString()).toBe(
      "2030-01-02T18:00:00.000Z"
    );
    expect(nextDailyRun(new Date("2030-12-31T23:00:00Z"), 18).toISOString()).toBe(
      "2031-01-01T18:00:00.000Z"
    );
  });
});

describe("daily scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T10:00:00Z"));
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("catches up shortly after boot, then runs every day at the hour", async () => {
    const sweep = vi.fn(async () => done);
    const scheduler = createDailyScheduler({ bootDelayMs: 30_000, hourUtc: 18, sweep });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sweep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sweep).toHaveBeenCalledTimes(1);

    // 18:00 the same day, then the next.
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(sweep).toHaveBeenCalledTimes(3);
    await scheduler.stop();
  });

  it("skips a sweep another process holds the lock for", async () => {
    lock.withAdvisoryLock.mockResolvedValueOnce({ ran: false } as never);
    const sweep = vi.fn(async () => done);
    const scheduler = createDailyScheduler({ bootDelayMs: 10, sweep });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(20);

    expect(sweep).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it("keeps its schedule after a sweep throws", async () => {
    const sweep = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(done);
    const scheduler = createDailyScheduler({ bootDelayMs: 10, hourUtc: 18, sweep });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(logger.error).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(9 * 60 * 60 * 1000);

    expect(sweep).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("tells a sweep in flight to stop, and waits for it no longer than the grace", async () => {
    let signal: AbortSignal | undefined;
    const sweep = vi.fn(async (options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const scheduler = createDailyScheduler({ bootDelayMs: 10, hourUtc: 18, sweep });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(signal?.aborted).toBe(false);
    let stopped = false;
    const stopping = scheduler.stop({ graceMs: 1_000 }).then(() => {
      stopped = true;
    });

    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(logger.warn).toHaveBeenCalled();
  });

  it("starts nothing after stop, and waits for a sweep in flight", async () => {
    const release = Promise.withResolvers<void>();
    const sweep = vi.fn(async () => {
      await release.promise;
      return done;
    });
    const scheduler = createDailyScheduler({ bootDelayMs: 10, hourUtc: 18, sweep });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(20);
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    release.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
