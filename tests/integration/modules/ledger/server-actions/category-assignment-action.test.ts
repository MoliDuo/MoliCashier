import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { startCategoryAssignmentAction } from "@/modules/ledger/server-actions/category-assignment";
import { getLatestCategoryAssignmentJobDto } from "@/modules/ledger/server/get-category-assignment-job";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
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
import { drainBackground } from "tests/helpers/background";
import { fakeAiTransport } from "tests/helpers/fake-ai";
import { setAiTransportForTests } from "@/lib/ai/client";

/** What the model replies to each request; every test scripts it. */
const generateContent = vi.fn();

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

/** Entries the model can be asked about, each on the live document. */
async function seedEntries(input: {
  documentId: string;
  categoryId: string | null;
  count: number;
}): Promise<string[]> {
  const db = getTestDb();
  const ids = Array.from({ length: input.count }, () => crypto.randomUUID());
  await db.insert(ledgerEntries).values(
    ids.map((id, position) => ({
      id,
      categoryId: input.categoryId,
      sourceDocumentId: input.documentId,
      position,
      amount: "10.00",
      currency: "CNY",
      itemName: `Item ${position + 1}`,
    }))
  );
  return ids;
}

async function setupLedger() {
  const db = getTestDb();
  const ledger = createLedgerData();
  const food = createCategoryData({ name: "吃喝", sortOrder: 0 });
  const home = createCategoryData({ name: "居家", sortOrder: 1 });
  const document = createSourceDocumentData();
  await db.insert(ledgers).values(ledger);
  await ensureTestLedgerBooks(db);
  await db.insert(entryCategories).values([food, home]);
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
  });
  await activateTestSourceDocumentProjection(db, document.id);
  return { food, home, document };
}

async function submitSelection(input: {
  ledgerEntryIds: string[];
  candidateCategoryIds: string[];
}) {
  return startCategoryAssignmentAction({
    requestKey: crypto.randomUUID(),
    mode: { kind: "ai", candidateCategoryIds: input.candidateCategoryIds },
    ledgerEntryIds: input.ledgerEntryIds,
  });
}

describe("submitSelection", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(
      testSession({ email: "reclassify@example.com" })
    );
    vi.clearAllMocks();
    setAiTransportForTests(fakeAiTransport((request) => generateContent(request)));
  });

  afterEach(() => {
    setAiTransportForTests(null);
  });

  it("runs the whole chain and reports what it moved", async () => {
    const db = getTestDb();
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 2,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({
        decisions: [
          { entry_index: 1, category_index: 1 },
          { entry_index: 2, category_index: 1 },
        ],
      }),
    });

    const job = await submitSelection({
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await drainBackground();

    expect(job).toMatchObject({ ok: true, job: { total: 2, appliedCount: 0 } });
    const stored = await getLatestCategoryAssignmentJobDto();
    expect(stored).toMatchObject({
      status: "succeeded",
      total: 2,
      appliedCount: 2,
      confirmedCount: 0,
      processedCount: 2,
    });
    const rows = await db
      .select({ id: ledgerEntries.id, categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries);
    expect(rows.every((row) => row.categoryId === food.id)).toBe(true);
  });

  it("fails incomplete model output instead of leaving entries undecided", async () => {
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: home.id,
      count: 3,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({
        decisions: [
          { entry_index: 1, category_index: 1 },
          { entry_index: 2, category_index: 0 },
          // Missing: the third entry is never mentioned.
        ],
      }),
    });

    await submitSelection({
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await drainBackground();

    await expect(getLatestCategoryAssignmentJobDto()).resolves.toMatchObject({
      status: "failed",
      appliedCount: 0,
      confirmedCount: 0,
      failedCount: 3,
      processedCount: 3,
    });
  });

  it("counts an entry the model left in place as confirmed", async () => {
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: food.id,
      count: 1,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({ decisions: [{ entry_index: 1, category_index: 1 }] }),
    });

    await submitSelection({
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await drainBackground();

    await expect(getLatestCategoryAssignmentJobDto()).resolves.toMatchObject({
      status: "succeeded",
      appliedCount: 0,
      confirmedCount: 1,
    });
  });

  it("accepts selections above 100 but rejects a candidate set that is too small", async () => {
    const { food, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 3,
    });
    await expect(
      submitSelection({
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id],
      })
    ).resolves.toEqual({ ok: false, code: "invalid" });
  });

  it("rejects a candidate category that is not in the ledger", async () => {
    const { food, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 1,
    });

    await expect(
      submitSelection({
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id, crypto.randomUUID()],
      })
    ).resolves.toEqual({ ok: false, code: "invalid" });
    await expect(getLatestCategoryAssignmentJobDto()).resolves.toBeNull();
  });

  it("rejects a candidate set that is no longer live before registering anything", async () => {
    const db = getTestDb();
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 1,
    });
    await db.delete(entryCategories).where(eq(entryCategories.id, home.id));

    await expect(
      submitSelection({
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id, home.id],
      })
    ).resolves.toEqual({ ok: false, code: "invalid" });
    await expect(getLatestCategoryAssignmentJobDto()).resolves.toBeNull();
  });

  it("reports a provider failure without losing the run", async () => {
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 1,
    });
    generateContent.mockResolvedValue({ content: "not json at all" });

    await submitSelection({
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await drainBackground();

    await expect(getLatestCategoryAssignmentJobDto()).resolves.toMatchObject({
      status: "failed",
      failedCount: 1,
    });
  });

  it("refuses a second run while one is active", async () => {
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 1,
    });
    // the worker runs the job straight away here, so the model call is held open
    // to keep the first run active until the second request arrives.
    const held = Promise.withResolvers<never>();
    held.promise.catch(() => {});
    generateContent.mockReturnValue(held.promise);
    await submitSelection({
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });

    try {
      await expect(
        submitSelection({
          ledgerEntryIds: entryIds,
          candidateCategoryIds: [food.id, home.id],
        })
      ).resolves.toEqual({ ok: false, code: "busy" });
    } finally {
      held.reject(new Error("released"));
    }
  });

  it("returns the started run when the same request is sent again", async () => {
    const { food, home, document } = await setupLedger();
    const entryIds = await seedEntries({
      documentId: document.id,
      categoryId: null,
      count: 2,
    });
    const input = {
      requestKey: crypto.randomUUID(),
      mode: { kind: "ai" as const, candidateCategoryIds: [food.id, home.id] },
      ledgerEntryIds: entryIds,
    };

    const first = await startCategoryAssignmentAction(input);
    const replay = await startCategoryAssignmentAction(input);
    expect(first.ok).toBe(true);
    expect(replay).toMatchObject({
      ok: true,
      job: { id: first.ok ? first.job.id : null, total: 2 },
    });
  });

  it("refuses a selection above the entry limit before reading it", async () => {
    await setupLedger();
    await expect(
      startCategoryAssignmentAction({
        requestKey: crypto.randomUUID(),
        mode: { kind: "clear" },
        ledgerEntryIds: Array.from({ length: 5001 }, () => crypto.randomUUID()),
      })
    ).resolves.toEqual({ ok: false, code: "invalid" });
  });
});
