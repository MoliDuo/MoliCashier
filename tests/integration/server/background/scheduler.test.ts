import { describe, expect, it, vi } from "vitest";
import { createDailyScheduler } from "@/server/background/scheduler";

describe("daily scheduler lock", () => {
  it("lets only one of two processes sweep at the same time", async () => {
    const release = Promise.withResolvers<void>();
    const sweep = vi.fn(async () => {
      await release.promise;
      return {} as never;
    });
    const secondFinished = Promise.withResolvers<string>();
    const first = createDailyScheduler({ bootDelayMs: 0, sweep });
    const second = createDailyScheduler({
      bootDelayMs: 0,
      sweep,
      onSweepFinished: (outcome) => secondFinished.resolve(outcome),
    });

    first.start();
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    second.start();

    // The second process finds the lock held and gives up without sweeping.
    await expect(secondFinished.promise).resolves.toBe("skipped");
    expect(sweep).toHaveBeenCalledTimes(1);

    release.resolve();
    await Promise.all([first.stop(), second.stop()]);
  });
});
