import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { extractionAttempts } from "@/persistence";
import { setAiTransportForTests } from "@/lib/ai/client";
import { fakeAiTransport } from "tests/helpers/fake-ai";
import { createBackgroundWorker, type BackgroundWorkerOptions } from "@/server/background/worker";
import { requestBackgroundWork } from "@/server/background/wake";

const workers: Array<ReturnType<typeof createBackgroundWorker>> = [];

function worker(pollIntervalMs = 60_000, options: BackgroundWorkerOptions = {}) {
  const created = createBackgroundWorker({ pollIntervalMs, ...options });
  workers.push(created);
  return created;
}

/** Resolves the next time each of the given lanes has gone to sleep. */
function idleLanes(lanes: readonly string[]) {
  const waiting = new Map(lanes.map((lane) => [lane, Promise.withResolvers<void>()]));
  return {
    onIdle: (lane: string) => waiting.get(lane)?.resolve(),
    idle: Promise.all([...waiting.values()].map((entry) => entry.promise)),
  };
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((created) => created.stop({ graceMs: 100 })));
  setAiTransportForTests(null);
  vi.restoreAllMocks();
});

async function pendingAttempt() {
  const db = getTestDb();
  await createTestLedger(db);
  const pending = await createPendingAttempt({
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    bookId: await testBookId(db),
  });
  return pending.attempt.id;
}

function findAttempt(attemptId: string) {
  return getTestDb().query.extractionAttempts.findFirst({
    where: eq(extractionAttempts.id, attemptId),
  });
}

/** A model call that never settles on its own and rejects when the run is aborted. */
function hangingModel() {
  const started = Promise.withResolvers<void>();
  setAiTransportForTests(
    fakeAiTransport(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          started.resolve();
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    )
  );
  return started.promise;
}

/** A model that only ever replies with something that is not the parser's JSON. */
function failingModel() {
  const transport = fakeAiTransport(() => "not json");
  setAiTransportForTests(transport);
  return transport;
}

describe("background worker", () => {
  it("runs the work that is due and reports how much", async () => {
    const attemptId = await pendingAttempt();
    failingModel();

    await expect(worker().drain()).resolves.toBe(1);

    const attempt = await findAttempt(attemptId);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.claimToken).toBeNull();
    await expect(worker().runOnce()).resolves.toBe(0);
  });

  it("wakes at once when work is requested, without waiting for the poll", async () => {
    const { onIdle, idle } = idleLanes(["processing", "category"]);
    const running = worker(60_000, { onIdle });
    failingModel();
    running.start();
    // Both lanes find nothing and go to sleep.
    await idle;

    const attemptId = await pendingAttempt();
    requestBackgroundWork();

    await vi.waitFor(async () => expect((await findAttempt(attemptId))?.status).toBe("failed"));
  });

  it("finds work nobody announced on its next poll", async () => {
    const attemptId = await pendingAttempt();
    failingModel();

    worker(20).start();

    await vi.waitFor(async () => expect((await findAttempt(attemptId))?.status).toBe("failed"));
  });

  it("runs the attempts that are due side by side", async () => {
    await pendingAttempt();
    await pendingAttempt();
    await pendingAttempt();
    const allStarted = Promise.withResolvers<void>();
    let started = 0;
    let waitedAlone = false;
    setAiTransportForTests(
      fakeAiTransport(async () => {
        started += 1;
        if (started === 3) allStarted.resolve();
        // One at a time, the first attempt would wait here for the other two in vain.
        await Promise.race([
          allStarted.promise,
          new Promise((resolve) => setTimeout(resolve, 2_000)).then(() => {
            waitedAlone = true;
          }),
        ]);
        return "not json";
      })
    );

    await expect(worker().drain()).resolves.toBe(3);
    expect(waitedAlone).toBe(false);
  });

  it("never runs more attempts at once than its concurrency allows", async () => {
    for (let index = 0; index < 5; index += 1) await pendingAttempt();
    let active = 0;
    let most = 0;
    setAiTransportForTests(
      fakeAiTransport(async () => {
        active += 1;
        most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return "not json";
      })
    );

    await expect(worker(60_000, { processingConcurrency: 2 }).drain()).resolves.toBe(5);
    expect(most).toBe(2);

    for (let index = 0; index < 5; index += 1) await pendingAttempt();
    most = 0;
    const running = worker(20, { processingConcurrency: 2 });
    running.start();
    await vi.waitFor(async () =>
      expect(
        (await getTestDb().query.extractionAttempts.findMany()).every(
          (attempt) => attempt.status === "failed"
        )
      ).toBe(true)
    );
    expect(most).toBe(2);
  });

  it("claims nothing new while it is stopping", async () => {
    const { onIdle, idle } = idleLanes(["processing"]);
    const heldId = await pendingAttempt();
    const started = hangingModel();
    const running = worker(20, { processingConcurrency: 1, onIdle });
    running.start();
    requestBackgroundWork();
    await started;
    // Full: the lane waits for the running attempt to finish.
    await idle;

    const stopped = running.stop({ graceMs: 200 });
    const lateId = await pendingAttempt();
    requestBackgroundWork();
    await stopped;

    expect(await findAttempt(lateId)).toMatchObject({ attemptCount: 0, claimToken: null });
    expect(await findAttempt(heldId)).toMatchObject({ status: "processing", claimToken: null });
  });

  it("claims nothing once stopping, even when the due work was already listed", async () => {
    const attemptId = await pendingAttempt();
    const transport = failingModel();
    const stopped = worker();
    await stopped.stop({ graceMs: 0 });

    await expect(stopped.runOnce()).resolves.toBe(0);

    expect(await findAttempt(attemptId)).toMatchObject({ attemptCount: 0, claimToken: null });
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("starts a newly submitted attempt while an earlier one is still running", async () => {
    const slowId = await pendingAttempt();
    const slowStarted = Promise.withResolvers<void>();
    let calls = 0;
    setAiTransportForTests(
      fakeAiTransport(({ signal }) => {
        calls += 1;
        if (calls > 1) return "not json";
        slowStarted.resolve();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      })
    );
    const running = worker();
    running.start();
    requestBackgroundWork();
    await slowStarted.promise;

    const quickId = await pendingAttempt();
    requestBackgroundWork();

    await vi.waitFor(async () => expect((await findAttempt(quickId))?.status).toBe("failed"));
    expect((await findAttempt(slowId))?.status).toBe("processing");
  });

  it("hands the attempt back uncounted when stopped mid-run", async () => {
    const attemptId = await pendingAttempt();
    const started = hangingModel();
    const running = worker();
    running.start();
    requestBackgroundWork();
    await started;
    expect((await findAttempt(attemptId))?.attemptCount).toBe(1);

    await running.stop({ graceMs: 50 });

    const attempt = await findAttempt(attemptId);
    expect(attempt).toMatchObject({ status: "processing", claimToken: null, attemptCount: 0 });
  });

  it("lets two workers share a queue without running anything twice", async () => {
    await pendingAttempt();
    await pendingAttempt();
    await pendingAttempt();
    const transport = failingModel();

    const ran = await Promise.all([worker().drain(), worker().drain()]);

    expect(ran[0]! + ran[1]!).toBe(3);
    // Each attempt asks once and, the reply being invalid, once more to repair it.
    expect(transport.complete).toHaveBeenCalledTimes(6);
  });

  it("picks up an attempt whose earlier holder died with its lease expired", async () => {
    const attemptId = await pendingAttempt();
    await getTestDb()
      .update(extractionAttempts)
      .set({
        claimToken: crypto.randomUUID(),
        claimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
        attemptCount: 1,
      })
      .where(eq(extractionAttempts.id, attemptId));
    failingModel();

    await worker().drain();

    expect((await findAttempt(attemptId))?.status).toBe("failed");
  });
});
