import "server-only";
import { logger } from "@/lib/logger";
import { BACKGROUND_POLL_INTERVAL_MS, PROCESSING_BATCH_SIZE } from "@/config/tuning";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { recoverProcessingJobs } from "@/server/processing/jobs";
import { runNextCategoryAssignmentJob } from "@/server/category-assignment/run";
import { onBackgroundWork } from "@/server/background/wake";

export interface BackgroundWorkerOptions {
  pollIntervalMs?: number;
}

export interface BackgroundWorker {
  /** Starts both lanes; they run until `stop`. */
  start(): void;
  /**
   * Stops claiming work, gives what is running `graceMs` to finish, then aborts it. Aborted work is
   * handed back uncounted, so the next process picks it up at once instead of waiting out a lease.
   */
  stop(options?: { graceMs?: number }): Promise<void>;
  /** One pass over both lanes; returns how many units of work ran. */
  runOnce(): Promise<number>;
  /** Passes until nothing is left; returns how many units of work ran. */
  drain(): Promise<number>;
}

const MAX_DRAIN_PASSES = 1000;
const ABORT_SETTLE_MS = 5_000;

/** One piece of claimed work: `key` names it so a lane does not start it twice, `done` says whether it ran. */
interface Unit {
  key: string;
  done: Promise<boolean>;
}

interface Lane {
  name: string;
  /**
   * When true the lane keeps looking for new work while what it started runs, so each unit runs
   * alongside the others; when false it waits for its units to finish before it looks again.
   */
  overlaps: boolean;
  /** Starts the due work this lane can claim right now, leaving out the keys in `running`. */
  startUnits(shutdown: AbortSignal, running: ReadonlySet<string>): Promise<Unit[]>;
}

const processingLane: Lane = {
  name: "processing",
  overlaps: true,
  async startUnits(shutdown, running) {
    // An attempt is its own queue entry; claiming it is a compare-and-swap, so losing the race to a
    // second process is harmless.
    const due = await recoverProcessingJobs(PROCESSING_BATCH_SIZE);
    if (shutdown.aborted) return [];
    return due
      .filter((job) => !running.has(job.attemptId))
      .map((job) => ({ key: job.attemptId, done: executeProcessingJob(job, { shutdown }) }));
  },
};

const categoryLane: Lane = {
  name: "category",
  overlaps: false,
  async startUnits(shutdown) {
    return [{ key: "category", done: runNextCategoryAssignmentJob(shutdown) }];
  },
};

function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref();
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Claims due work and runs it to completion, one lane for extraction and one for batch category
 * assignment, so a category job waiting out a retry never holds up extraction. Extraction attempts run
 * side by side, each from the moment it is due; category jobs run one at a time.
 */
export function createBackgroundWorker(options: BackgroundWorkerOptions = {}): BackgroundWorker {
  const pollIntervalMs = options.pollIntervalMs ?? BACKGROUND_POLL_INTERVAL_MS;
  const shutdown = new AbortController();
  const lanes = [processingLane, categoryLane];
  let stopping = false;
  let running: Array<{ wake(): void; done: Promise<void> }> | null = null;
  let unsubscribe: (() => void) | null = null;

  function startLane(lane: Lane) {
    let pending = false;
    let wakeUp: (() => void) | null = null;

    const wake = () => {
      pending = true;
      wakeUp?.();
    };

    const sleep = async (): Promise<void> => {
      if (pending) {
        pending = false;
        return;
      }
      const poll = delay(pollIntervalMs);
      await Promise.race([
        poll.promise,
        new Promise<void>((resolve) => {
          wakeUp = resolve;
        }),
      ]);
      wakeUp = null;
      poll.cancel();
      pending = false;
    };

    const inFlight = new Map<string, Promise<boolean>>();

    const track = (unit: Unit): Promise<boolean> => {
      const done = unit.done
        .catch((error: unknown) => {
          logger.error({ error, lane: lane.name }, "Background lane failed");
          return false;
        })
        .finally(() => inFlight.delete(unit.key));
      inFlight.set(unit.key, done);
      return done;
    };

    const done = (async () => {
      while (!stopping) {
        let ran = 0;
        try {
          const units = await lane.startUnits(shutdown.signal, new Set(inFlight.keys()));
          const tracked = units.map(track);
          ran = lane.overlaps
            ? tracked.length
            : (await Promise.all(tracked)).filter(Boolean).length;
        } catch (error) {
          logger.error({ error, lane: lane.name }, "Background lane failed");
        }
        if (stopping) break;
        if (ran === 0) await sleep();
      }
      await Promise.all(inFlight.values());
    })();

    return { wake, done };
  }

  async function runOnce(): Promise<number> {
    let ran = 0;
    for (const lane of lanes) {
      const units = await lane.startUnits(shutdown.signal, new Set());
      ran += (await Promise.all(units.map((unit) => unit.done))).filter(Boolean).length;
    }
    return ran;
  }

  return {
    start() {
      if (running != null) return;
      running = lanes.map(startLane);
      unsubscribe = onBackgroundWork(() => {
        for (const lane of running ?? []) lane.wake();
      });
    },

    async stop({ graceMs = 20_000 } = {}) {
      stopping = true;
      unsubscribe?.();
      unsubscribe = null;
      for (const lane of running ?? []) lane.wake();
      const finished = Promise.all((running ?? []).map((lane) => lane.done)).then(() => undefined);
      const grace = delay(graceMs);
      const timedOut = await Promise.race([
        finished.then(() => false),
        grace.promise.then(() => true),
      ]);
      grace.cancel();
      if (!timedOut) return;
      logger.warn({ graceMs }, "Background work did not finish in time; handing it back");
      shutdown.abort();
      const settle = delay(ABORT_SETTLE_MS);
      await Promise.race([finished, settle.promise]);
      settle.cancel();
    },

    runOnce,

    async drain() {
      let total = 0;
      for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
        const ran = await runOnce();
        if (ran === 0) return total;
        total += ran;
      }
      throw new Error("Background work did not settle");
    },
  };
}
