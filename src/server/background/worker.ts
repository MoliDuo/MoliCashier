import "server-only";
import { logger } from "@/lib/logger";
import { BACKGROUND_POLL_INTERVAL_MS, PROCESSING_CONCURRENCY } from "@/config/tuning";
import { runClaimedJob } from "@/server/processing/execute-job";
import { claimProcessingJob, recoverProcessingJobs } from "@/server/processing/jobs";
import { runNextCategoryAssignmentJob } from "@/server/category-assignment/run";
import { onBackgroundWork } from "@/server/background/wake";

export interface BackgroundWorkerOptions {
  pollIntervalMs?: number;
  /** How many extraction attempts run at once; `runOnce` and `drain` keep to it too. */
  processingConcurrency?: number;
  /**
   * Called each time a lane has nothing it can start and goes to sleep until it is woken, polls or,
   * when full, a unit finishes. Tests wait on it instead of on the clock.
   */
  onIdle?: (lane: string) => void;
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

interface StartContext {
  shutdown: AbortSignal;
  /** Keys of the units this lane is already running. */
  running: ReadonlySet<string>;
  /** How many more units the lane may start now. */
  capacity: number;
  /** True once the worker is stopping; nothing new is claimed from then on. */
  stopping: () => boolean;
}

interface Lane {
  name: string;
  /**
   * When set, the lane keeps looking for new work while what it started runs, each unit alongside
   * the others, up to this many at once; when null it waits for its units to finish before it
   * looks again.
   */
  concurrency: number | null;
  /** Claims and starts the due work this lane can run right now; returns only what it claimed. */
  startUnits(context: StartContext): Promise<Unit[]>;
}

function processingLane(concurrency: number): Lane {
  return {
    name: "processing",
    concurrency,
    async startUnits({ shutdown, running, capacity, stopping }) {
      // The due list can still hold attempts this process runs, between their claim and the lease
      // showing; asking for that many more leaves `capacity` of the others.
      const due = await recoverProcessingJobs(capacity + running.size);
      const candidates = due.filter((job) => !running.has(job.attemptId)).slice(0, capacity);
      const units: Unit[] = [];
      for (const job of candidates) {
        // A stop that came while the list was read must not see new work claimed in its grace.
        if (stopping()) break;
        // Claiming is a compare-and-swap, so losing the race to a second process is harmless; the
        // attempt is then simply not this lane's to run.
        const claim = await claimProcessingJob(job.attemptId);
        if (claim == null) continue;
        units.push({
          key: job.attemptId,
          done: runClaimedJob(claim, { shutdown }).then(() => true),
        });
      }
      return units;
    },
  };
}

const categoryLane: Lane = {
  name: "category",
  concurrency: null,
  async startUnits({ shutdown, stopping }) {
    if (stopping()) return [];
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
 * side by side, each from the moment it is due, up to `processingConcurrency` at once; category jobs
 * run one at a time.
 */
export function createBackgroundWorker(options: BackgroundWorkerOptions = {}): BackgroundWorker {
  const pollIntervalMs = options.pollIntervalMs ?? BACKGROUND_POLL_INTERVAL_MS;
  const processingConcurrency = Math.max(
    1,
    options.processingConcurrency ?? PROCESSING_CONCURRENCY
  );
  const shutdown = new AbortController();
  const lanes = [processingLane(processingConcurrency), categoryLane];
  let stopping = false;
  const isStopping = () => stopping;
  let running: Array<{ wake(): void; done: Promise<void> }> | null = null;
  let unsubscribe: (() => void) | null = null;

  function startLane(lane: Lane) {
    let pending = false;
    let wakeUp: (() => void) | null = null;

    const wake = () => {
      pending = true;
      wakeUp?.();
    };

    /** Waits for a wake, the poll or, when given, `until`; a wake that came meanwhile ends it at once. */
    const sleep = async (until?: Promise<unknown>): Promise<void> => {
      if (pending) {
        pending = false;
        return;
      }
      options.onIdle?.(lane.name);
      const poll = delay(pollIntervalMs);
      await Promise.race([
        poll.promise,
        new Promise<void>((resolve) => {
          wakeUp = resolve;
        }),
        ...(until == null ? [] : [until]),
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
        const capacity = lane.concurrency == null ? 1 : lane.concurrency - inFlight.size;
        if (capacity <= 0) {
          // Full: nothing is claimed until a unit finishes, or a wake or the poll comes round.
          await sleep(Promise.race(inFlight.values()));
          continue;
        }
        let ran = 0;
        try {
          const units = await lane.startUnits({
            shutdown: shutdown.signal,
            running: new Set(inFlight.keys()),
            capacity,
            stopping: isStopping,
          });
          const tracked = units.map(track);
          ran =
            lane.concurrency != null
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
      const units = await lane.startUnits({
        shutdown: shutdown.signal,
        running: new Set(),
        capacity: lane.concurrency ?? 1,
        stopping: isStopping,
      });
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
