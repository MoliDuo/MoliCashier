import "server-only";
import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/lib/db/advisory-lock";
import { DAILY_MAINTENANCE_BOOT_DELAY_MS, DAILY_MAINTENANCE_HOUR_UTC } from "@/config/tuning";
import { runDailyMaintenance, type DailyMaintenanceOptions } from "@/server/maintenance/daily";

/** Held while a sweep runs, so that of several processes sharing a database only one sweeps. */
const DAILY_MAINTENANCE_LOCK_KEY = 1_947_001;

export interface DailyScheduler {
  start(): void;
  /**
   * Stops scheduling, tells a sweep that is running to stop after its current step, and waits for
   * it up to `graceMs`. The sweep is idempotent, so one cut short is simply run again after boot.
   */
  stop(options?: { graceMs?: number }): Promise<void>;
}

export interface DailySchedulerOptions {
  bootDelayMs?: number;
  hourUtc?: number;
  sweep?: (options?: DailyMaintenanceOptions) => ReturnType<typeof runDailyMaintenance>;
  /** Called after each scheduled sweep: whether it ran, another process held it, or it threw. */
  onSweepFinished?: (outcome: "ran" | "skipped" | "failed") => void;
}

const DEFAULT_STOP_GRACE_MS = 20_000;

/** The next moment after `now` at which the clock in UTC reads `hourUtc`:00. */
export function nextDailyRun(now: Date, hourUtc: number): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc)
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Runs the daily maintenance sweep from inside the process: once shortly after boot, to make up for
 * a day the process was down, and then every day at `hourUtc`. Every sweep is idempotent, so running
 * one more than needed costs nothing, and the advisory lock keeps two processes from sweeping at once.
 */
export function createDailyScheduler(options: DailySchedulerOptions = {}): DailyScheduler {
  const bootDelayMs = options.bootDelayMs ?? DAILY_MAINTENANCE_BOOT_DELAY_MS;
  const hourUtc = options.hourUtc ?? DAILY_MAINTENANCE_HOUR_UTC;
  const sweep = options.sweep ?? runDailyMaintenance;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const stopping = new AbortController();

  async function runSweep(): Promise<void> {
    let outcome: "ran" | "skipped" | "failed" = "ran";
    try {
      const result = await withAdvisoryLock(DAILY_MAINTENANCE_LOCK_KEY, () =>
        sweep({ signal: stopping.signal })
      );
      if (!result.ran) {
        outcome = "skipped";
        logger.info("Daily maintenance is running in another process; skipping");
        return;
      }
      const failed = Object.entries(result.value)
        .filter(([, stepOutcome]) => stepOutcome === "failed")
        .map(([step]) => step);
      logger.info({ failedSteps: failed }, "Daily maintenance finished");
    } catch (error) {
      outcome = "failed";
      logger.error({ error }, "Daily maintenance failed");
    } finally {
      options.onSweepFinished?.(outcome);
    }
  }

  function arm(delayMs: number, then: () => void) {
    timer = setTimeout(then, delayMs);
    timer.unref();
  }

  function scheduleNextDay() {
    if (stopped) return;
    arm(nextDailyRun(new Date(), hourUtc).getTime() - Date.now(), () => {
      running = runSweep().finally(scheduleNextDay);
    });
  }

  return {
    start() {
      if (timer != null || stopped) return;
      arm(bootDelayMs, () => {
        running = runSweep().finally(scheduleNextDay);
      });
    },
    async stop({ graceMs = DEFAULT_STOP_GRACE_MS } = {}) {
      stopped = true;
      clearTimeout(timer);
      stopping.abort();
      let grace: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        running.then(() => false),
        new Promise<boolean>((resolve) => {
          grace = setTimeout(() => resolve(true), graceMs);
          grace.unref();
        }),
      ]);
      clearTimeout(grace);
      if (timedOut) logger.warn({ graceMs }, "Daily maintenance did not stop in time; leaving it");
    },
  };
}
