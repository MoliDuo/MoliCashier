import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  categoryAssignmentDocuments,
  categoryAssignmentEntries,
  categoryAssignmentJobs,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { listCategoryAssignmentEntryStates } from "@/server/category-assignment/assignments";
import { getTestDb } from "tests/setup";
import { createLedgerData, createSourceDocumentData } from "tests/helpers/factories";
import { ensureTestLedgerBooks } from "tests/helpers/schema-setup";

describe("category assignment entry states", () => {
  it("lists the entries still waiting and the ones that failed, and nothing the run settled", async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);
    const document = createSourceDocumentData();
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    const [category] = await db.insert(entryCategories).values({ name: "Snacks" }).returning();
    const entryIds = Array.from({ length: 6 }, () => crypto.randomUUID());
    await db.insert(ledgerEntries).values(
      entryIds.map((id, position) => ({
        id,
        sourceDocumentId: document.id,
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
    await db.insert(categoryAssignmentDocuments).values({
      jobId: job!.id,
      sourceDocumentId: document.id,
      selectionOrder: 0,
      status: "pending",
    });
    const outcomes = [null, "applied", "failed", "conflict", "failed", "cancelled"] as const;
    await db.insert(categoryAssignmentEntries).values(
      entryIds.map((id, index) => ({
        jobId: job!.id,
        ledgerEntryId: id,
        sourceDocumentId: document.id,
        selectionOrder: index,
        outcome: outcomes[index] ?? null,
      }))
    );
    // The reader fixed the fifth entry by hand after the run failed to place it.
    await db
      .update(ledgerEntries)
      .set({ categoryId: category!.id })
      .where(eq(ledgerEntries.id, entryIds[4]!));

    await expect(listCategoryAssignmentEntryStates({ jobId: job!.id })).resolves.toEqual({
      jobId: job!.id,
      pendingIds: [entryIds[0]],
      failedIds: [entryIds[2]],
    });
  });

  it("is empty for a run it does not know", async () => {
    await expect(
      listCategoryAssignmentEntryStates({ jobId: crypto.randomUUID() })
    ).resolves.toMatchObject({ pendingIds: [], failedIds: [] });
  });
});
