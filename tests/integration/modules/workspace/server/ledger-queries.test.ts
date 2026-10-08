import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { ledgerEntries, ledgers } from "@/persistence";
import { requireLedger } from "@/modules/ledger/access";
import { runLedgerQuery, type LedgerQueryContext } from "@/modules/workspace/server/ledger-queries";

async function context(): Promise<LedgerQueryContext> {
  return { ledger: await requireLedger() };
}

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

describe("ledger query registry", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
  });

  describe("source-document-date-impact", () => {
    it("counts documents without entries, which still move to the new date", async () => {
      const empty = await documentWithEntries(0);

      await expect(
        runLedgerQuery(
          "source-document-date-impact",
          {
            sourceDocumentIds: [empty.sourceDocumentId, empty.sourceDocumentId],
            ledgerEntryIds: [],
          },
          await context()
        )
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
        runLedgerQuery(
          "source-document-date-impact",
          {
            sourceDocumentIds: [withEntries.sourceDocumentId, empty.sourceDocumentId],
            ledgerEntryIds: [withEntries.entryIds[0]!],
          },
          await context()
        )
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
        runLedgerQuery(
          "source-document-date-impact",
          { sourceDocumentIds: [empty.sourceDocumentId] },
          await context()
        )
      ).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe("batch-entry-date-impact", () => {
    it("counts every entry on the selected entries' documents", async () => {
      const withEntries = await documentWithEntries(3);

      await expect(
        runLedgerQuery("batch-entry-date-impact", [withEntries.entryIds[0]!], await context())
      ).resolves.toEqual({
        selectedEntryCount: 1,
        sourceDocumentCount: 1,
        affectedEntryCount: 3,
        sourceDocumentIds: [withEntries.sourceDocumentId],
      });
    });

    it("refuses ids that are not entry ids", async () => {
      await expect(
        runLedgerQuery("batch-entry-date-impact", ["not-an-id"], await context())
      ).rejects.toThrow();
    });
  });
});
