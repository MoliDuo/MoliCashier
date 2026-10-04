import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

type Next =
  | {
      kind: "document";
      document: {
        sourceDocumentId: string;
        runNumber: number;
        completedChunkCount: number;
        lastErrorCode: string | null;
      };
    }
  | { kind: "wait"; delayMs: number }
  | { kind: "done" }
  | { kind: "lost" };

const state = vi.hoisted(() => ({
  queue: [] as Next[],
  claims: 0,
  lease: new AbortController(),
  shutdown: new AbortController(),
}));

function subjects(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ledgerEntryId: `entry-${index}`,
    itemName: "Item",
    description: null,
    amount: "1.00",
    currency: "CNY",
    currentCategoryId: null,
    currentCategoryName: null,
  }));
}

const adapters = vi.hoisted(() => ({
  claimJob: vi.fn(async () => {
    state.claims += 1;
    return state.claims === 1
      ? {
          jobId: "job-1",
          claimToken: "token-1",
          mode: { kind: "ai" as const, candidateCategoryIds: ["category-1", "category-2"] },
          candidates: [
            { id: "category-1", name: "One", description: null },
            { id: "category-2", name: "Two", description: null },
          ],
          customPrompt: null as string | null,
          learnedPreferences: null as string | null,
        }
      : null;
  }),
  next: vi.fn(async (): Promise<Next> => state.queue.shift() ?? { kind: "done" }),
  loadSelection: vi.fn(async (input: { sourceDocumentId: string }) => [
    `entry-${input.sourceDocumentId}`,
  ]),
  loadDocumentGroups: vi.fn(async (input: { ledgerEntryIds: string[] }) => [
    {
      sourceDocumentId: input.ledgerEntryIds[0]!.replace("entry-", ""),
      title: null,
      documentDate: "2026-09-10",
      inputText: null,
      storedFileIds: [],
      subjects: subjects(1),
    },
  ]),
  decide: vi.fn(async (input: { group: { subjects: Array<{ ledgerEntryId: string }> } }) => {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return {
      decisions: input.group.subjects.map((subject) => ({
        ledgerEntryId: subject.ledgerEntryId,
        categoryId: "category-1",
      })),
      confirmedCount: 0,
    };
  }),
  persistDecisions: vi.fn(async (_input: { completedChunkCount: number }) => true),
  markEvidenceIncomplete: vi.fn(async () => undefined),
  yieldDocument: vi.fn(async () => undefined),
  reschedule: vi.fn(async (_input: { errorCode: string; delayMs: number }) => true),
  fail: vi.fn(async (_input: { errorCode: string }) => true),
  release: vi.fn(async () => undefined),
  renew: vi.fn(async () => true),
  apply: vi.fn(async (_input: { sourceDocumentId: string }) => ({
    status: "applied",
    appliedCount: 1,
    confirmedCount: 0,
    conflictCount: 0,
  })),
}));

vi.mock("@/config/tuning", () => ({
  BACKGROUND_MAX_ATTEMPTS: 3,
}));
vi.mock("@/lib/db/lease", () => ({
  holdLease: () => ({ signal: state.lease.signal, stop: () => undefined }),
}));
vi.mock("@/server/category-assignment/assignments", () => ({
  claimCategoryAssignmentJob: adapters.claimJob,
  nextCategoryAssignmentDocument: adapters.next,
  loadCategoryAssignmentSelection: adapters.loadSelection,
  persistCategoryAssignmentDecisions: adapters.persistDecisions,
  markCategoryAssignmentEvidenceIncomplete: adapters.markEvidenceIncomplete,
  yieldCategoryAssignmentDocument: adapters.yieldDocument,
  rescheduleCategoryAssignmentDocument: adapters.reschedule,
  failCategoryAssignmentDocument: adapters.fail,
  releaseCategoryAssignmentJob: adapters.release,
  renewCategoryAssignmentLease: adapters.renew,
}));
vi.mock("@/server/category-assignment/document-groups", () => ({
  loadCategoryAssignmentDocumentGroups: adapters.loadDocumentGroups,
}));
vi.mock("@/modules/source-document/server/category-assignments", () => ({
  applyCategoryAssignments: adapters.apply,
}));
vi.mock("@/server/category-assignment/decide-entry-categories", () => ({
  decideEntryCategories: adapters.decide,
}));
vi.mock("@/server/processing/evidence", () => ({
  loadStoredFilesForAI: vi.fn(async () => []),
  isSuccessfulLoadImageResult: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/security/log-identifier", () => ({ logIdentifier: () => "hashed" }));

import { runNextCategoryAssignmentJob } from "@/server/category-assignment/run";

function document(
  index: number,
  overrides: Partial<{ runNumber: number; completedChunkCount: number; lastErrorCode: string }> = {}
): Next {
  return {
    kind: "document",
    document: {
      sourceDocumentId: `document-${index}`,
      runNumber: 1,
      completedChunkCount: 0,
      lastErrorCode: null,
      ...overrides,
    },
  };
}

async function run() {
  const running = runNextCategoryAssignmentJob(state.shutdown.signal);
  await vi.runAllTimersAsync();
  return running;
}

describe("category assignment run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    vi.clearAllMocks();
    state.queue = [];
    state.claims = 0;
    state.lease = new AbortController();
    state.shutdown = new AbortController();
  });
  afterEach(() => vi.useRealTimers());

  it("works through the job's documents one at a time and then releases it", async () => {
    state.queue = [document(1), document(2)];

    await expect(run()).resolves.toBe(true);
    expect(adapters.decide).toHaveBeenCalledTimes(2);
    expect(adapters.apply.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ sourceDocumentId: "document-1" }),
      expect.objectContaining({ sourceDocumentId: "document-2" }),
    ]);
    expect(adapters.release).toHaveBeenCalledTimes(1);
  });

  it("hands the job's prompt and learned preferences to every decision", async () => {
    state.queue = [document(1)];
    adapters.claimJob.mockImplementationOnce(async () => ({
      jobId: "job-1",
      claimToken: "token-1",
      mode: { kind: "ai" as const, candidateCategoryIds: ["category-1", "category-2"] },
      candidates: [
        { id: "category-1", name: "One", description: null },
        { id: "category-2", name: "Two", description: null },
      ],
      customPrompt: "星巴克算餐饮",
      learnedPreferences: "- 滴滴算交通",
    }));

    await run();

    expect(adapters.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        customPrompt: "星巴克算餐饮",
        learnedPreferences: "- 滴滴算交通",
      })
    );
  });

  it("returns without work when no job can be claimed", async () => {
    state.claims = 1;
    await expect(run()).resolves.toBe(false);
    expect(adapters.next).not.toHaveBeenCalled();
  });

  it("runs a long job to completion rather than stopping on a time budget", async () => {
    state.queue = [document(1), document(2), document(3), document(4)];
    const startedAt = Date.now();

    await run();
    expect(adapters.decide).toHaveBeenCalledTimes(4);
    expect(Date.now() - startedAt).toBe(80_000);
    expect(adapters.release).toHaveBeenCalledTimes(1);
  });

  it("splits a document into request blocks and resumes after the stored checkpoint", async () => {
    state.queue = [document(1, { completedChunkCount: 1 })];
    adapters.loadDocumentGroups.mockResolvedValueOnce([
      {
        sourceDocumentId: "document-1",
        title: null,
        documentDate: "2026-09-10",
        inputText: null,
        storedFileIds: [],
        subjects: subjects(120),
      },
    ]);

    await run();
    expect(adapters.decide.mock.calls.map(([input]) => input.group.subjects.length)).toEqual([
      50, 20,
    ]);
    expect(
      adapters.persistDecisions.mock.calls.map(([input]) => input.completedChunkCount)
    ).toEqual([2, 3]);
    expect(adapters.apply).toHaveBeenCalledTimes(1);
  });

  it("hands a document back when shutdown arrives between its request blocks", async () => {
    state.queue = [document(1), document(2)];
    adapters.loadDocumentGroups.mockResolvedValueOnce([
      {
        sourceDocumentId: "document-1",
        title: null,
        documentDate: "2026-09-10",
        inputText: null,
        storedFileIds: [],
        subjects: subjects(120),
      },
    ]);
    adapters.decide.mockImplementationOnce(async (input) => {
      state.shutdown.abort();
      return {
        decisions: input.group.subjects.map((subject) => ({
          ledgerEntryId: subject.ledgerEntryId,
          categoryId: "category-1",
        })),
        confirmedCount: 0,
      };
    });

    await run();
    expect(adapters.decide).toHaveBeenCalledTimes(1);
    expect(adapters.yieldDocument).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1" }),
      "document-1"
    );
    expect(adapters.apply).not.toHaveBeenCalled();
    expect(adapters.fail).not.toHaveBeenCalled();
    expect(adapters.release).toHaveBeenCalledTimes(1);
  });

  it("hands a document back uncounted when shutdown aborts its request", async () => {
    state.queue = [document(1), document(2)];
    adapters.decide.mockImplementationOnce(async () => {
      state.shutdown.abort();
      throw new Error("aborted");
    });

    await run();
    expect(adapters.yieldDocument).toHaveBeenCalledTimes(1);
    expect(adapters.fail).not.toHaveBeenCalled();
    expect(adapters.reschedule).not.toHaveBeenCalled();
    expect(adapters.decide).toHaveBeenCalledTimes(1);
    expect(adapters.release).toHaveBeenCalledTimes(1);
  });

  it("puts a document back to wait out a transient failure", async () => {
    state.queue = [document(1)];
    adapters.decide.mockRejectedValueOnce(
      new Error("parse failed", {
        cause: new AppError("rate limited", "ai_rate_limited", 503, { retryAfterMs: 5_000 }),
      })
    );

    await run();
    expect(adapters.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "ai_rate_limited", delayMs: 5_000 })
    );
    expect(adapters.fail).not.toHaveBeenCalled();
  });

  it("fails a document on a transient failure in its last attempt", async () => {
    state.queue = [document(1, { runNumber: 3 })];
    adapters.decide.mockRejectedValueOnce(new AppError("timeout", "ai_timeout", 504));

    await run();
    expect(adapters.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "ai_timeout" })
    );
    expect(adapters.reschedule).not.toHaveBeenCalled();
  });

  it("fails a document at once on a permanent failure", async () => {
    state.queue = [document(1), document(2)];
    adapters.decide.mockRejectedValueOnce(new AppError("bad output", "ai_schema_invalid", 502));

    await run();
    expect(adapters.fail).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDocumentId: "document-1", errorCode: "ai_schema_invalid" })
    );
    expect(adapters.apply).toHaveBeenCalledTimes(1);
  });

  it("fails a document whose earlier attempts all died, without asking the model", async () => {
    state.queue = [document(1, { runNumber: 4, lastErrorCode: "ai_rate_limited" })];

    await run();
    expect(adapters.decide).not.toHaveBeenCalled();
    expect(adapters.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "ai_rate_limited" })
    );
  });

  it("records nothing when the lease is lost mid-request", async () => {
    state.queue = [document(1), document(2)];
    adapters.decide.mockImplementationOnce(async () => {
      state.lease.abort();
      throw new Error("aborted");
    });

    await run();
    expect(adapters.fail).not.toHaveBeenCalled();
    expect(adapters.reschedule).not.toHaveBeenCalled();
    expect(adapters.decide).toHaveBeenCalledTimes(1);
  });

  it("waits for a retry to come due", async () => {
    state.queue = [{ kind: "wait", delayMs: 8_000 }, document(1)];
    const startedAt = Date.now();

    await run();
    expect(adapters.decide).toHaveBeenCalledTimes(1);
    expect(Date.now() - startedAt).toBe(28_000);
  });

  it("stops waiting for a retry when shutdown arrives", async () => {
    state.queue = [{ kind: "wait", delayMs: 60_000 }, document(1)];

    const running = runNextCategoryAssignmentJob(state.shutdown.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    state.shutdown.abort();
    await running;

    expect(adapters.decide).not.toHaveBeenCalled();
    expect(adapters.release).toHaveBeenCalledTimes(1);
  });
});
