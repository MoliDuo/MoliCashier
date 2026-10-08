import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import {
  getCategoryAssignmentJob,
  getLatestCategoryAssignmentJob,
} from "@/server/category-assignment/reads";
import { getTestDb } from "tests/setup";
import { createLedgerData, createSourceDocumentData } from "tests/helpers/factories";
import { ensureTestLedgerBooks } from "tests/helpers/schema-setup";

describe("category assignment job reads", () => {
  it("counts progress from the rows through both lookup paths", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);
    const documents = [createSourceDocumentData(), createSourceDocumentData()];
    for (const document of documents) {
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      });
    }
    const entryIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(ledgerEntries).values(
      entryIds.map((id, position) => ({
        id,
        sourceDocumentId: documents[position === 2 ? 1 : 0]!.id,
        position,
        amount: "1.00",
        currency: "CNY",
        itemName: `Item ${position}`,
      }))
    );
    const [job] = await db
      .insert(categoryAssignmentJobs)
      .values({ mode: "clear", status: "running" })
      .returning();
    await db.insert(categoryAssignmentDocuments).values([
      {
        jobId: job!.id,
        sourceDocumentId: documents[0]!.id,
        selectionOrder: 0,
        status: "succeeded",
        evidenceIncomplete: true,
      },
      {
        jobId: job!.id,
        sourceDocumentId: documents[1]!.id,
        selectionOrder: 2,
        status: "pending",
        attemptCount: 1,
        errorCode: "ai_rate_limited",
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    ]);
    await db.insert(categoryAssignmentEntries).values(
      entryIds.map((id, index) => ({
        jobId: job!.id,
        ledgerEntryId: id,
        sourceDocumentId: documents[index === 2 ? 1 : 0]!.id,
        selectionOrder: index,
        outcome: index === 0 ? ("applied" as const) : index === 1 ? ("conflict" as const) : null,
      }))
    );

    const read = await getCategoryAssignmentJob({ jobId: job!.id });
    expect(read).toMatchObject({
      id: job!.id,
      mode: { kind: "clear" },
      status: "running",
      entryCount: 3,
      appliedCount: 1,
      conflictCount: 1,
      failedCount: 0,
      documentTotal: 2,
      documentCompleted: 1,
      activeDocumentCount: 0,
      retryingDocumentCount: 1,
      evidenceIncomplete: true,
    });
    expect(read?.nextRetryAt).not.toBeNull();
    expect(await getLatestCategoryAssignmentJob()).toMatchObject({
      id: job!.id,
    });
    expect(await getCategoryAssignmentJob({ jobId: crypto.randomUUID() })).toBeNull();
  });
});
