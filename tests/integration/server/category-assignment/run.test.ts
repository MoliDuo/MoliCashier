import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  categoryAssignmentDocuments,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { getTestDb } from "tests/setup";
import {
  createCategoryData,
  createLedgerData,
  createSourceDocumentData,
} from "tests/helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { fakeAiTransport, type FakeResponder } from "tests/helpers/fake-ai";
import { setAiTransportForTests, type CompleteRequest } from "@/lib/ai/client";
import { AppError } from "@/lib/errors";
import {
  cancelCategoryAssignment,
  nextCategoryAssignmentDocument,
  startCategoryAssignment,
} from "@/server/category-assignment/assignments";
import { runNextCategoryAssignmentJob } from "@/server/category-assignment/run";

// Passes through to the real function; one test makes it fail as a database outage would.
vi.mock("@/server/category-assignment/assignments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/category-assignment/assignments")>();
  return {
    ...actual,
    nextCategoryAssignmentDocument: vi.fn(actual.nextCategoryAssignmentDocument),
  };
});

afterEach(() => {
  setAiTransportForTests(null);
  vi.restoreAllMocks();
});

async function seedLedger() {
  const db = getTestDb();
  await db.insert(ledgers).values(createLedgerData());
  await ensureTestLedgerBooks(db);
  const food = createCategoryData({ name: "Food", sortOrder: 0 });
  const home = createCategoryData({ name: "Home", sortOrder: 1 });
  await db.insert(entryCategories).values([food, home]);
  return { food, home };
}

async function addDocument(entryCount: number) {
  const db = getTestDb();
  const document = createSourceDocumentData();
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
  });
  await activateTestSourceDocumentProjection(db, document.id);
  const entryIds = Array.from({ length: entryCount }, () => crypto.randomUUID());
  await db.insert(ledgerEntries).values(
    entryIds.map((id, position) => ({
      id,
      sourceDocumentId: document.id,
      position,
      amount: "12.00",
      currency: "CNY",
      itemName: `Item ${position + 1}`,
    }))
  );
  return { documentId: document.id, entryIds };
}

async function startAiJob(
  categories: { food: { id: string; name: string }; home: { id: string; name: string } },
  entryIds: string[],
  extra: { customPrompt?: string; learnedPreferences?: string } = {}
) {
  return startCategoryAssignment({
    requestKey: crypto.randomUUID(),
    mode: { kind: "ai", candidateCategoryIds: [categories.food.id, categories.home.id] },
    ledgerEntryIds: entryIds,
    candidates: [categories.food, categories.home].map(({ id, name }) => ({
      id,
      name,
      description: null,
    })),
    customPrompt: extra.customPrompt ?? null,
    learnedPreferences: extra.learnedPreferences ?? null,
  });
}

/** How many numbered entries the request lists. */
function entriesAsked(request: CompleteRequest): number {
  const content = request.messages[0]?.content;
  const text = typeof content === "string" ? content : (content?.[0] as { text: string }).text;
  return text.match(/^\d+\. item_name:/gm)?.length ?? 0;
}

/** A model that puts every entry it is asked about into the first candidate. */
const answerAll: FakeResponder = (request) =>
  JSON.stringify({
    decisions: Array.from({ length: entriesAsked(request) }, (_, index) => ({
      entry_index: index + 1,
      category_index: 1,
    })),
  });

function model(responder: FakeResponder = answerAll) {
  const transport = fakeAiTransport(responder);
  setAiTransportForTests(transport);
  return transport;
}

async function documentWork(jobId: string, sourceDocumentId: string) {
  const rows = await getTestDb()
    .select()
    .from(categoryAssignmentDocuments)
    .where(
      and(
        eq(categoryAssignmentDocuments.jobId, jobId),
        eq(categoryAssignmentDocuments.sourceDocumentId, sourceDocumentId)
      )
    );
  return rows[0]!;
}

async function setDocumentWork(
  jobId: string,
  values: Partial<typeof categoryAssignmentDocuments.$inferInsert>
) {
  await getTestDb()
    .update(categoryAssignmentDocuments)
    .set(values)
    .where(eq(categoryAssignmentDocuments.jobId, jobId));
}

async function storedJob(jobId: string) {
  return getTestDb().query.categoryAssignmentJobs.findFirst({
    where: eq(categoryAssignmentJobs.id, jobId),
  });
}

async function categoryOf(entryId: string) {
  const [row] = await getTestDb()
    .select({ categoryId: ledgerEntries.categoryId })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.id, entryId));
  return row?.categoryId ?? null;
}

describe("running a category assignment job", () => {
  it("returns without work when no job can be claimed", async () => {
    await seedLedger();
    const transport = model();

    await expect(runNextCategoryAssignmentJob(new AbortController().signal)).resolves.toBe(false);
    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("works through the job's documents one at a time, then settles and releases it", async () => {
    const categories = await seedLedger();
    const first = await addDocument(1);
    const second = await addDocument(2);
    const job = await startAiJob(categories, [...first.entryIds, ...second.entryIds]);
    const transport = model();

    await expect(runNextCategoryAssignmentJob(new AbortController().signal)).resolves.toBe(true);

    expect(transport.complete.mock.calls.map(([request]) => entriesAsked(request))).toEqual([1, 2]);
    for (const entryId of [...first.entryIds, ...second.entryIds]) {
      expect(await categoryOf(entryId)).toBe(categories.food.id);
    }
    expect(await storedJob(job.id)).toMatchObject({
      status: "succeeded",
      claimToken: null,
      claimExpiresAt: null,
    });
  });

  it("hands the job's prompt and learned preferences to every decision", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    await startAiJob(categories, document.entryIds, {
      customPrompt: "星巴克算餐饮",
      learnedPreferences: "- 滴滴算交通",
    });
    const transport = model();

    await runNextCategoryAssignmentJob(new AbortController().signal);

    const system = transport.complete.mock.calls[0]?.[0].system;
    expect(system).toContain("星巴克算餐饮");
    expect(system).toContain("- 滴滴算交通");
  });

  it("splits a document into request blocks and resumes after the stored checkpoint", async () => {
    const categories = await seedLedger();
    const document = await addDocument(120);
    const job = await startAiJob(categories, document.entryIds);
    await setDocumentWork(job.id, { completedChunkCount: 1 });
    const transport = model();

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(transport.complete.mock.calls.map(([request]) => entriesAsked(request))).toEqual([
      50, 20,
    ]);
    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      completedChunkCount: 3,
    });
  });

  it("hands a document back, keeping its blocks, when shutdown arrives between them", async () => {
    const categories = await seedLedger();
    const document = await addDocument(120);
    const job = await startAiJob(categories, document.entryIds);
    const shutdown = new AbortController();
    const transport = model((request) => {
      shutdown.abort();
      return answerAll(request);
    });

    await runNextCategoryAssignmentJob(shutdown.signal);

    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "pending",
      completedChunkCount: 1,
      attemptCount: 0,
    });
    expect(await storedJob(job.id)).toMatchObject({ status: "running", claimToken: null });
  });

  it("hands a document back uncounted when shutdown aborts its request", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    const shutdown = new AbortController();
    model(() => {
      shutdown.abort();
      throw new Error("aborted");
    });

    await runNextCategoryAssignmentJob(shutdown.signal);

    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "pending",
      attemptCount: 0,
      errorCode: null,
    });
    expect(await storedJob(job.id)).toMatchObject({ claimToken: null });
  });

  it("puts a document back to wait out a transient failure", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    const shutdown = new AbortController();
    model(() => {
      throw new AppError("limited", "ai_rate_limited", 503, { retryAfterMs: 5_000 });
    });

    const running = runNextCategoryAssignmentJob(shutdown.signal);
    // The run then waits for the retry to come due; stop it there.
    await vi.waitFor(async () =>
      expect((await documentWork(job.id, document.documentId)).errorCode).toBe("ai_rate_limited")
    );
    shutdown.abort();
    await running;

    const work = await documentWork(job.id, document.documentId);
    expect(work).toMatchObject({ status: "pending", attemptCount: 1 });
    expect(work.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 3_000);
  });

  it("fails a document on a transient failure in its last attempt", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    await setDocumentWork(job.id, { attemptCount: 2 });
    model(() => {
      throw new AppError("timeout", "ai_timeout", 504);
    });

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "failed",
      errorCode: "ai_timeout",
    });
    expect(await storedJob(job.id)).toMatchObject({ status: "failed", claimToken: null });
  });

  it("asks again when the model's answer does not fit the protocol", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const categories = await seedLedger();
    const document = await addDocument(2);
    const job = await startAiJob(categories, document.entryIds);
    let calls = 0;
    const transport = model((request) =>
      // The first answer leaves an entry out.
      (calls += 1) === 1
        ? JSON.stringify({ decisions: [{ entry_index: 1, category_index: 1 }] })
        : answerAll(request)
    );

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
    });
    expect(await categoryOf(document.entryIds[1]!)).toBe(categories.food.id);
  });

  it("fails an answer that keeps not fitting once the attempts run out", async () => {
    const categories = await seedLedger();
    const document = await addDocument(2);
    const job = await startAiJob(categories, document.entryIds);
    await setDocumentWork(job.id, { attemptCount: 2 });
    model(() => JSON.stringify({ decisions: [{ entry_index: 1, category_index: 1 }] }));

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "failed",
      errorCode: "ai_schema_invalid",
    });
  });

  it("fails a document at once on an unexplained error, without blaming the provider", async () => {
    const categories = await seedLedger();
    const first = await addDocument(1);
    const second = await addDocument(1);
    const job = await startAiJob(categories, [...first.entryIds, ...second.entryIds]);
    let calls = 0;
    model((request) => {
      if ((calls += 1) === 1) throw new Error("something unexpected");
      return answerAll(request);
    });

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(await documentWork(job.id, first.documentId)).toMatchObject({
      status: "failed",
      errorCode: "unknown",
      attemptCount: 1,
    });
    expect(await documentWork(job.id, second.documentId)).toMatchObject({ status: "succeeded" });
    expect(await storedJob(job.id)).toMatchObject({ status: "partial" });
  });

  it("fails a document whose earlier attempts all died, without asking the model", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    await setDocumentWork(job.id, { attemptCount: 3, errorCode: "ai_rate_limited" });
    const transport = model();

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(transport.complete).not.toHaveBeenCalled();
    expect(await documentWork(job.id, document.documentId)).toMatchObject({
      status: "failed",
      errorCode: "ai_rate_limited",
    });
  });

  it("records nothing when the job is cancelled mid-request", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    model(async (request) => {
      await cancelCategoryAssignment({ jobId: job.id });
      return answerAll(request);
    });

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(await categoryOf(document.entryIds[0]!)).toBeNull();
    expect(await storedJob(job.id)).toMatchObject({ status: "cancelled", claimToken: null });
  });

  /** A job with one document due now and a second one due after `delay`. */
  async function jobWithLaterDocument(delay: string) {
    const categories = await seedLedger();
    const now = await addDocument(1);
    const later = await addDocument(1);
    const job = await startAiJob(categories, [...now.entryIds, ...later.entryIds]);
    await getTestDb()
      .update(categoryAssignmentDocuments)
      .set({ nextAttemptAt: sql`clock_timestamp() + ${delay}::interval` })
      .where(
        and(
          eq(categoryAssignmentDocuments.jobId, job.id),
          eq(categoryAssignmentDocuments.sourceDocumentId, later.documentId)
        )
      );
    return { job, now, later };
  }

  it("waits for a retry to come due, then runs it", async () => {
    const { job } = await jobWithLaterDocument("0.3 second");
    const transport = model();
    const startedAt = Date.now();

    await runNextCategoryAssignmentJob(new AbortController().signal);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(await storedJob(job.id)).toMatchObject({ status: "succeeded" });
  });

  it("stops waiting for a retry when shutdown arrives, and hands the job back", async () => {
    const { job, now } = await jobWithLaterDocument("1 hour");
    const transport = model();
    const shutdown = new AbortController();

    const running = runNextCategoryAssignmentJob(shutdown.signal);
    await vi.waitFor(async () =>
      expect((await documentWork(job.id, now.documentId)).status).toBe("succeeded")
    );
    shutdown.abort();
    await expect(running).resolves.toBe(true);

    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(await storedJob(job.id)).toMatchObject({ status: "running", claimToken: null });
  });

  it("hands the job back even when the run fails outside a document", async () => {
    const categories = await seedLedger();
    const document = await addDocument(1);
    const job = await startAiJob(categories, document.entryIds);
    model();
    const outage = Object.assign(new Error("terminating connection"), { code: "57P01" });
    vi.mocked(nextCategoryAssignmentDocument).mockRejectedValueOnce(outage);

    await expect(runNextCategoryAssignmentJob(new AbortController().signal)).rejects.toBe(outage);

    expect(await storedJob(job.id)).toMatchObject({ status: "running", claimToken: null });
  });
});
