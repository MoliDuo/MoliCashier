import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import { ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { updateSourceDocuments } from "@/modules/source-document/server/updates";
import { batchUpdateLedgerEntries } from "@/modules/source-document/server/entry-commands";
import { must } from "tests/helpers/must";

const projectionEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("current-runtime target adapters", () => {
  it("creates and edits manual projections, and deletes through the aggregate", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const created = await createTestRecord(getTestDb(), {
      title: "Manual",
      entryDate: "2026-07-15",
      entries: [projectionEntry],
      bookId: await testBookId(db),
    });
    const originalEntry = must(
      await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
      }),
      "original entry"
    );
    expect(
      await db.query.extractionAttempts.findMany({
        where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
      })
    ).toEqual([]);

    await expect(
      updateSourceDocuments({
        sourceDocumentIds: [created.sourceDocumentId],
        data: { title: "Edited" },
      })
    ).resolves.toMatchObject({ updatedCount: 1 });
    await expect(
      batchUpdateLedgerEntries({
        sourceDocumentIds: [created.sourceDocumentId],
        ledgerEntryIds: [originalEntry.id],
        amount: "18.00",
      })
    ).resolves.toMatchObject({ affectedCount: 1 });
    const replacementEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
    });
    expect(replacementEntries).toHaveLength(1);
    const replacementEntry = replacementEntries[0];
    expect(replacementEntry).toMatchObject({
      id: originalEntry.id,
      amount: "18.000",
    });

    await expect(
      deleteSourceDocumentAtomically({
        sourceDocumentId: created.sourceDocumentId,
      })
    ).resolves.toMatchObject({ deleted: true });
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, created.sourceDocumentId),
      })
    ).toBeUndefined();
    expect(
      await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, replacementEntry!.id),
      })
    ).toBeUndefined();
  });
});
