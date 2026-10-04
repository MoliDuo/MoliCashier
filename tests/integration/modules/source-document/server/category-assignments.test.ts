import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  categoryAssignmentEntries,
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
import { applyCategoryAssignments } from "@/modules/source-document/server/category-assignments";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import {
  cancelCategoryAssignment,
  claimCategoryAssignmentJob,
  failCategoryAssignmentDocument,
  nextCategoryAssignmentDocument,
  persistCategoryAssignmentDecisions,
  releaseCategoryAssignmentJob,
  renewCategoryAssignmentLease,
  rescheduleCategoryAssignmentDocument,
  resolveLatestConflictSelection,
  retryCategoryAssignmentFailures,
  startCategoryAssignment,
  yieldCategoryAssignmentDocument,
} from "@/server/category-assignment/assignments";
import { getCategoryAssignmentJob } from "@/server/category-assignment/jobs";

async function addDocument(itemNames: string[]) {
  const db = getTestDb();
  const document = createSourceDocumentData();
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
  });
  await activateTestSourceDocumentProjection(db, document.id);
  const entryIds = itemNames.map(() => crypto.randomUUID());
  await db.insert(ledgerEntries).values(
    itemNames.map((itemName, position) => ({
      id: entryIds[position]!,
      sourceDocumentId: document.id,
      position,
      amount: "12.00",
      currency: "CNY",
      itemName,
    }))
  );
  return { documentId: document.id, entryIds };
}

async function seedLedger() {
  const db = getTestDb();
  const ledger = createLedgerData();
  const category = createCategoryData({ name: "Meals", sortOrder: 0 });
  await db.insert(ledgers).values(ledger);
  await ensureTestLedgerBooks(db);
  await db.insert(entryCategories).values(category);
  const document = await addDocument(["Lunch"]);
  return { category, ...document };
}

async function startAssign(
  fixture: { category: { id: string } },
  ledgerEntryIds: string[],
  requestKey: string = crypto.randomUUID()
) {
  return startCategoryAssignment({
    requestKey,
    mode: { kind: "assign", categoryId: fixture.category.id },
    ledgerEntryIds,
    candidates: [],
    customPrompt: null,
  });
}

/** Moves the job's lease into the past, as if its worker had died. */
async function expireJobLease(jobId: string) {
  await getTestDb()
    .update(categoryAssignmentJobs)
    .set({ claimExpiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(categoryAssignmentJobs.id, jobId));
}

async function storedJob(jobId: string) {
  return getTestDb().query.categoryAssignmentJobs.findFirst({
    where: eq(categoryAssignmentJobs.id, jobId),
  });
}

describe("the learned preferences a run carries", () => {
  it("snapshots them when the run starts, and a retry keeps the same ones", async () => {
    const fixture = await seedLedger();
    const started = await startCategoryAssignment({
      requestKey: crypto.randomUUID(),
      mode: { kind: "assign", categoryId: fixture.category.id },
      ledgerEntryIds: fixture.entryIds,
      candidates: [],
      customPrompt: "星巴克算餐饮",
      learnedPreferences: "- 滴滴算交通",
    });
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    expect(job).toMatchObject({ customPrompt: "星巴克算餐饮", learnedPreferences: "- 滴滴算交通" });
    await nextCategoryAssignmentDocument(job!);
    await failCategoryAssignmentDocument({
      lease: job!,
      sourceDocumentId: fixture.documentId,
      errorCode: "ai_schema_invalid",
    });
    await nextCategoryAssignmentDocument(job!);
    await releaseCategoryAssignmentJob(job!);

    const retry = await retryCategoryAssignmentFailures({
      jobId: started.id,
      requestKey: crypto.randomUUID(),
    });

    const retried = await claimCategoryAssignmentJob({ jobId: retry.id });
    expect(retried).toMatchObject({
      customPrompt: "星巴克算餐饮",
      learnedPreferences: "- 滴滴算交通",
    });
  });

  it("carries none when the ledger has learned nothing", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);

    const job = await claimCategoryAssignmentJob({ jobId: started.id });

    expect(job?.learnedPreferences).toBeNull();
  });
});

describe("starting a category assignment", () => {
  it("registers the job, its documents and its entries in one call", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(["Coffee", "Tea"]);
    const started = await startAssign(fixture, [
      second.entryIds[1]!,
      fixture.entryIds[0]!,
      second.entryIds[0]!,
    ]);

    const db = getTestDb();
    const documents = await db
      .select({
        sourceDocumentId: categoryAssignmentDocuments.sourceDocumentId,
        selectionOrder: categoryAssignmentDocuments.selectionOrder,
        status: categoryAssignmentDocuments.status,
      })
      .from(categoryAssignmentDocuments)
      .where(eq(categoryAssignmentDocuments.jobId, started.id));
    expect(documents).toEqual(
      expect.arrayContaining([
        { sourceDocumentId: second.documentId, selectionOrder: 0, status: "pending" },
        { sourceDocumentId: fixture.documentId, selectionOrder: 1, status: "pending" },
      ])
    );
    const entries = await db
      .select({
        id: categoryAssignmentEntries.ledgerEntryId,
        order: categoryAssignmentEntries.selectionOrder,
        target: categoryAssignmentEntries.targetCategoryId,
        decided: categoryAssignmentEntries.decisionPersisted,
      })
      .from(categoryAssignmentEntries)
      .where(eq(categoryAssignmentEntries.jobId, started.id))
      .orderBy(categoryAssignmentEntries.selectionOrder);
    expect(entries).toEqual([
      { id: second.entryIds[1], order: 0, target: fixture.category.id, decided: true },
      { id: fixture.entryIds[0], order: 1, target: fixture.category.id, decided: true },
      { id: second.entryIds[0], order: 2, target: fixture.category.id, decided: true },
    ]);
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      status: "pending",
      entryCount: 3,
      documentTotal: 2,
      documentCompleted: 0,
      activeDocumentCount: 0,
    });
  });

  it("returns the same job for a replay and refuses the key for another selection", async () => {
    const fixture = await seedLedger();
    const requestKey = crypto.randomUUID();
    const started = await startAssign(fixture, fixture.entryIds, requestKey);

    await expect(startAssign(fixture, fixture.entryIds, requestKey)).resolves.toEqual(started);
    const other = await addDocument(["Dinner"]);
    await expect(startAssign(fixture, other.entryIds, requestKey)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const rows = await getTestDb()
      .select()
      .from(categoryAssignmentEntries)
      .where(eq(categoryAssignmentEntries.jobId, started.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses entries the ledger does not hold and a second active run", async () => {
    const fixture = await seedLedger();
    await expect(startAssign(fixture, [crypto.randomUUID()])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await startAssign(fixture, fixture.entryIds);
    await expect(startAssign(fixture, fixture.entryIds)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("running a category assignment", () => {
  it("leases a job to one worker until the lease expires", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);

    const first = await claimCategoryAssignmentJob({ jobId: started.id });
    expect(first).toMatchObject({ jobId: started.id });
    await expect(claimCategoryAssignmentJob({ jobId: started.id })).resolves.toBeNull();
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      status: "running",
      activeDocumentCount: 1,
    });

    await expireJobLease(started.id);
    await expect(renewCategoryAssignmentLease(first!)).resolves.toBe(false);
    const second = await claimCategoryAssignmentJob();
    expect(second?.claimToken).not.toBe(first!.claimToken);
    await expect(renewCategoryAssignmentLease(second!)).resolves.toBe(true);
  });

  it("rejects writes from a worker whose lease was taken over", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const first = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(first!);
    await expireJobLease(started.id);
    const second = await claimCategoryAssignmentJob({ jobId: started.id });

    await expect(
      applyCategoryAssignments({ lease: first!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "claim_lost" });
    await expect(
      persistCategoryAssignmentDecisions({
        lease: first!,
        sourceDocumentId: fixture.documentId,
        decisions: [],
        completedChunkCount: 1,
      })
    ).resolves.toBe(false);
    await expect(nextCategoryAssignmentDocument(first!)).resolves.toEqual({ kind: "lost" });
    const [unchanged] = await getTestDb()
      .select({ categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, fixture.entryIds[0]!));
    expect(unchanged?.categoryId).toBeNull();

    await expect(
      applyCategoryAssignments({ lease: second!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "applied", appliedCount: 1, confirmedCount: 0, conflictCount: 0 });
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, fixture.documentId),
    });
    expect(document?.version).toBe(1);
  });

  it("stops a running worker when the run is cancelled", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);

    await expect(cancelCategoryAssignment({ jobId: started.id })).resolves.toBe(true);
    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "claim_lost" });
    await releaseCategoryAssignmentJob(job!);
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      status: "cancelled",
      cancelledCount: 1,
      documentCompleted: 1,
    });
  });

  it("waits out a transient failure and counts only real attempts", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      kind: "document",
      document: { runNumber: 1, lastErrorCode: null },
    });

    await expect(
      rescheduleCategoryAssignmentDocument({
        lease: job!,
        sourceDocumentId: fixture.documentId,
        errorCode: "ai_rate_limited",
        delayMs: 60_000,
      })
    ).resolves.toBe(true);
    const waiting = await nextCategoryAssignmentDocument(job!);
    expect(waiting.kind).toBe("wait");
    expect(waiting.kind === "wait" && waiting.delayMs).toBeGreaterThan(55_000);
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      retryingDocumentCount: 1,
      activeDocumentCount: 0,
    });

    // Not due: released, the job is not claimable until the retry comes due.
    await releaseCategoryAssignmentJob(job!);
    await expect(claimCategoryAssignmentJob({ jobId: started.id })).resolves.toBeNull();
    await getTestDb()
      .update(categoryAssignmentDocuments)
      .set({ nextAttemptAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(categoryAssignmentDocuments.jobId, started.id));
    const again = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(again!)).resolves.toMatchObject({
      kind: "document",
      document: { runNumber: 2, lastErrorCode: "ai_rate_limited" },
    });
    // Running out of budget hands the document back without spending the attempt.
    await yieldCategoryAssignmentDocument(again!, fixture.documentId);
    await expect(nextCategoryAssignmentDocument(again!)).resolves.toMatchObject({
      kind: "document",
      document: { runNumber: 2 },
    });
  });

  it("settles the job when its last document gets an outcome", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(["Coffee"]);
    const started = await startAssign(fixture, [fixture.entryIds[0]!, second.entryIds[0]!]);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });

    const first = await nextCategoryAssignmentDocument(job!);
    expect(first).toMatchObject({ document: { sourceDocumentId: fixture.documentId } });
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    const last = await nextCategoryAssignmentDocument(job!);
    expect(last).toMatchObject({ document: { sourceDocumentId: second.documentId } });
    await failCategoryAssignmentDocument({
      lease: job!,
      sourceDocumentId: second.documentId,
      errorCode: "ai_schema_invalid",
    });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toEqual({ kind: "done" });

    await releaseCategoryAssignmentJob(job!);
    expect(await storedJob(started.id)).toMatchObject({
      status: "partial",
      claimToken: null,
      claimExpiresAt: null,
    });
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      entryCount: 2,
      appliedCount: 1,
      failedCount: 1,
      documentTotal: 2,
      documentCompleted: 2,
      activeDocumentCount: 0,
    });
  });

  it("claims a job left without its final status so the status is written", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    // The worker dies before releasing the job.
    await expireJobLease(started.id);

    const recovered = await claimCategoryAssignmentJob();
    await expect(nextCategoryAssignmentDocument(recovered!)).resolves.toEqual({ kind: "done" });
    await releaseCategoryAssignmentJob(recovered!);
    expect(await storedJob(started.id)).toMatchObject({ status: "succeeded" });
  });

  it("drops a document deleted mid-run and settles the job on what is left", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(["Coffee"]);
    const started = await startAssign(fixture, [fixture.entryIds[0]!, second.entryIds[0]!]);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      document: { sourceDocumentId: fixture.documentId },
    });

    await deleteSourceDocumentAtomically({ sourceDocumentId: fixture.documentId });
    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "skipped" });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      document: { sourceDocumentId: second.documentId },
    });
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: second.documentId });
    await releaseCategoryAssignmentJob(job!);

    expect(await storedJob(started.id)).toMatchObject({ status: "succeeded" });
    await expect(getCategoryAssignmentJob({ jobId: started.id })).resolves.toMatchObject({
      entryCount: 1,
      appliedCount: 1,
      documentTotal: 1,
    });
  });

  it("marks only an entry recategorized after selection as a conflict", async () => {
    const fixture = await seedLedger();
    const db = getTestDb();
    const [other] = await db
      .insert(entryCategories)
      .values(createCategoryData({ name: "Travel", sortOrder: 1 }))
      .returning();
    const secondEntryId = crypto.randomUUID();
    await db.insert(ledgerEntries).values({
      id: secondEntryId,
      sourceDocumentId: fixture.documentId,
      position: 1,
      amount: "8.00",
      currency: "CNY",
      itemName: "Coffee",
    });
    const started = await startAssign(fixture, [fixture.entryIds[0]!, secondEntryId]);
    await db
      .update(ledgerEntries)
      .set({ categoryId: other!.id })
      .where(eq(ledgerEntries.id, secondEntryId));
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);

    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "applied", appliedCount: 1, confirmedCount: 0, conflictCount: 1 });
    await releaseCategoryAssignmentJob(job!);

    const entries = await db
      .select({ id: ledgerEntries.id, categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, fixture.documentId));
    expect(new Map(entries.map((entry) => [entry.id, entry.categoryId]))).toEqual(
      new Map([
        [fixture.entryIds[0]!, fixture.category.id],
        [secondEntryId, other!.id],
      ])
    );
    const outcomes = await db
      .select({
        id: categoryAssignmentEntries.ledgerEntryId,
        outcome: categoryAssignmentEntries.outcome,
        errorCode: categoryAssignmentEntries.errorCode,
      })
      .from(categoryAssignmentEntries)
      .where(eq(categoryAssignmentEntries.jobId, started.id));
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { id: fixture.entryIds[0], outcome: "applied", errorCode: null },
        { id: secondEntryId, outcome: "conflict", errorCode: "entry_changed" },
      ])
    );
    expect(await storedJob(started.id)).toMatchObject({ status: "partial" });

    await expect(resolveLatestConflictSelection({ jobId: started.id })).resolves.toEqual({
      mode: { kind: "assign", categoryId: fixture.category.id },
      retryOfJobId: started.id,
      ledgerEntryIds: [secondEntryId],
    });
  });

  it("refuses to categorize conflicts again for a run that had none", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    await releaseCategoryAssignmentJob(job!);

    await expect(resolveLatestConflictSelection({ jobId: started.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const stored = await getTestDb()
      .select({ outcome: categoryAssignmentEntries.outcome })
      .from(categoryAssignmentEntries)
      .where(eq(categoryAssignmentEntries.jobId, started.id));
    expect(stored).toEqual([{ outcome: "applied" }]);
  });
});
