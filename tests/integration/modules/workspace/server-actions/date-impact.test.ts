import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { ledgerEntries, ledgers } from "@/persistence";
import { previewSourceDocumentDateImpactAction } from "@/modules/workspace/server-actions/date-impact";

describe("previewSourceDocumentDateImpactAction", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
  });

  async function documentWithEntries(count: number) {
    const db = getTestDb();
    const sourceDocumentId = await createTestSourceDocument(db, { status: "completed" });
    const entries =
      count === 0
        ? []
        : await db
            .insert(ledgerEntries)
            .values(
              Array.from({ length: count }, (_, index) => ({
                sourceDocumentId,
                itemName: `Item ${index}`,
                amount: "10.00",
                currency: "CNY",
              }))
            )
            .returning({ id: ledgerEntries.id });
    return { sourceDocumentId, entryIds: entries.map((entry) => entry.id) };
  }

  it("counts documents without entries, which still move to the new date", async () => {
    const empty = await documentWithEntries(0);

    await expect(
      previewSourceDocumentDateImpactAction({
        sourceDocumentIds: [empty.sourceDocumentId, empty.sourceDocumentId],
        ledgerEntryIds: [],
      })
    ).resolves.toEqual({
      selectedEntryCount: 0,
      sourceDocumentCount: 1,
      affectedEntryCount: 0,
      sourceDocumentIds: [empty.sourceDocumentId],
    });
  });

  it("adds a selected entry's siblings and the entry-less documents to a mixed preview", async () => {
    const withEntries = await documentWithEntries(2);
    const empty = await documentWithEntries(0);

    await expect(
      previewSourceDocumentDateImpactAction({
        sourceDocumentIds: [withEntries.sourceDocumentId, empty.sourceDocumentId],
        ledgerEntryIds: [withEntries.entryIds[0]!],
      })
    ).resolves.toEqual({
      selectedEntryCount: 1,
      sourceDocumentCount: 2,
      affectedEntryCount: 2,
      sourceDocumentIds: [withEntries.sourceDocumentId, empty.sourceDocumentId],
    });
  });

  it("refuses an input without the entry id list instead of reading it", async () => {
    const empty = await documentWithEntries(0);

    await expect(
      previewSourceDocumentDateImpactAction({
        sourceDocumentIds: [empty.sourceDocumentId],
      } as never)
    ).rejects.toBeInstanceOf(ZodError);
  });
});
