import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { ConflictError } from "@/lib/errors";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getSourceDocumentInTransaction } from "@/modules/source-document/server/reads/list";
import {
  applyDuplicateSuggestion,
  dismissDuplicateSuggestion,
} from "@/modules/source-document/server/duplicate-suggestion";
import { batchUpdateLedgerEntries } from "@/modules/source-document/server/entry-commands";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";

const entry = (itemName: string, amount: string) => ({
  categoryId: null,
  amount,
  currency: "CNY",
  itemName,
  description: null,
});

/** An earlier record, and a newer one whose "Data cable" repeats the earlier one's. */
async function createFixture(
  newEntries = [entry("Data cable", "19.90"), entry("Desk lamp", "42.00")]
) {
  const db = getTestDb();
  await createTestLedger(db);
  const bookId = await testBookId(db);
  const earlier = await createTestRecord(db, {
    bookId,
    title: "Taobao orders",
    entryDate: "2026-09-10",
    entries: [entry("Data cable", "19.90"), entry("Phone case", "5.00")],
  });
  const current = await createTestRecord(db, {
    bookId,
    title: "Second screenshot",
    entryDate: "2026-09-10",
    entries: newEntries,
  });
  const rows = (sourceDocumentId: string) =>
    db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
      orderBy: (row, { asc }) => [asc(row.position)],
    });
  const [earlierCable] = await rows(earlier.sourceDocumentId);
  const currentEntries = await rows(current.sourceDocumentId);
  const suggestionId = crypto.randomUUID();
  await db
    .update(sourceDocuments)
    .set({
      duplicateSuggestion: {
        schemaVersion: 1,
        id: suggestionId,
        items: [
          {
            ledgerEntryId: currentEntries[0]!.id,
            snapshot: {
              itemName: currentEntries[0]!.itemName,
              amount: currentEntries[0]!.amount,
              currency: "CNY",
            },
            matched: {
              ledgerEntryId: earlierCable!.id,
              sourceDocumentId: earlier.sourceDocumentId,
            },
          },
        ],
      },
    })
    .where(eq(sourceDocuments.id, current.sourceDocumentId));
  return { db, earlier, current, currentEntries, suggestionId };
}

async function detail(sourceDocumentId: string) {
  return getTestDb().transaction((tx) => getSourceDocumentInTransaction(tx, sourceDocumentId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

async function storedSuggestion(sourceDocumentId: string) {
  const document = await getTestDb().query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  return document;
}

describe("duplicate suggestion", () => {
  describe("reading", () => {
    it("shows each flagged entry beside the entry it repeats", async () => {
      const fixture = await createFixture();

      const document = await detail(fixture.current.sourceDocumentId);

      expect(document?.duplicateSuggestion).toMatchObject({
        id: fixture.suggestionId,
        coversWholeDocument: false,
        items: [
          {
            ledgerEntryId: fixture.currentEntries[0]!.id,
            itemName: "Data cable",
            matched: {
              sourceDocumentId: fixture.earlier.sourceDocumentId,
              title: "Taobao orders",
              documentDate: "2026-09-10",
              itemName: "Data cable",
            },
          },
        ],
      });
    });

    it("flags the record on the list while the suggestion is pending", async () => {
      const fixture = await createFixture();

      const page = await listStreamPage({ limit: 20 });

      const byId = new Map(page.items.map((item) => [item.id, item]));
      expect(byId.get(fixture.current.sourceDocumentId)?.pendingSuggestions).toEqual(["duplicate"]);
      expect(byId.get(fixture.earlier.sourceDocumentId)?.pendingSuggestions).toEqual([]);
    });

    it("withdraws the suggestion everywhere when the record it points at is deleted", async () => {
      const fixture = await createFixture();

      await deleteSourceDocumentAtomically({ sourceDocumentId: fixture.earlier.sourceDocumentId });

      expect((await detail(fixture.current.sourceDocumentId))?.duplicateSuggestion).toBeNull();
      const page = await listStreamPage({ limit: 20 });
      expect(page.items.find((item) => item.id === fixture.current.sourceDocumentId)).toMatchObject(
        { pendingSuggestions: [] }
      );
    });

    it("marks a record whose every entry is flagged as covering the whole record", async () => {
      const fixture = await createFixture([entry("Data cable", "19.90")]);

      const document = await detail(fixture.current.sourceDocumentId);

      expect(document?.duplicateSuggestion?.coversWholeDocument).toBe(true);
    });
  });

  describe("applying", () => {
    it("removes the flagged entry, keeps the rest and clears the suggestion", async () => {
      const fixture = await createFixture();

      const result = await applyDuplicateSuggestion({
        sourceDocumentId: fixture.current.sourceDocumentId,
        suggestionId: fixture.suggestionId,
      });

      expect(result).toMatchObject({ removedCount: 1, deleted: false });
      expect(result.sourceDocument?.ledgerEntries.map((row) => row.itemName)).toEqual([
        "Desk lamp",
      ]);
      const stored = await storedSuggestion(fixture.current.sourceDocumentId);
      expect(stored?.duplicateSuggestion).toBeNull();
      expect(stored?.version).toBe(2);
    });

    it("deletes the record when nothing but repeats would be left", async () => {
      const fixture = await createFixture([entry("Data cable", "19.90")]);

      const result = await applyDuplicateSuggestion({
        sourceDocumentId: fixture.current.sourceDocumentId,
        suggestionId: fixture.suggestionId,
      });

      expect(result).toEqual({ removedCount: 1, deleted: true, sourceDocument: null });
      expect(await storedSuggestion(fixture.current.sourceDocumentId)).toBeUndefined();
    });

    it("refuses a suggestion that has been replaced", async () => {
      const fixture = await createFixture();

      await expect(
        applyDuplicateSuggestion({
          sourceDocumentId: fixture.current.sourceDocumentId,
          suggestionId: crypto.randomUUID(),
        })
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("keeps an entry the owner changed, so applying has nothing to remove", async () => {
      const fixture = await createFixture();
      await fixture.db
        .update(ledgerEntries)
        .set({ itemName: "Renamed" })
        .where(eq(ledgerEntries.id, fixture.currentEntries[0]!.id));

      await expect(
        applyDuplicateSuggestion({
          sourceDocumentId: fixture.current.sourceDocumentId,
          suggestionId: fixture.suggestionId,
        })
      ).rejects.toBeInstanceOf(ConflictError);
      const remaining = await fixture.db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, fixture.current.sourceDocumentId),
      });
      expect(remaining).toHaveLength(2);
    });
  });

  describe("dismissing", () => {
    it("keeps every entry and drops the suggestion without a new version", async () => {
      const fixture = await createFixture();

      await expect(
        dismissDuplicateSuggestion({
          sourceDocumentId: fixture.current.sourceDocumentId,
          suggestionId: fixture.suggestionId,
        })
      ).resolves.toEqual({ dismissed: true });

      const stored = await storedSuggestion(fixture.current.sourceDocumentId);
      expect(stored?.duplicateSuggestion).toBeNull();
      expect(stored?.version).toBe(1);
      const remaining = await fixture.db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, fixture.current.sourceDocumentId),
      });
      expect(remaining).toHaveLength(2);
    });

    it("leaves a newer suggestion alone when an older one is dismissed", async () => {
      const fixture = await createFixture();

      await dismissDuplicateSuggestion({
        sourceDocumentId: fixture.current.sourceDocumentId,
        suggestionId: crypto.randomUUID(),
      });

      const stored = await storedSuggestion(fixture.current.sourceDocumentId);
      expect(stored?.duplicateSuggestion?.id).toBe(fixture.suggestionId);
    });
  });

  describe("editing the record", () => {
    it("drops a flagged entry from the suggestion once the owner changes it", async () => {
      const fixture = await createFixture();

      await batchUpdateLedgerEntries({
        sourceDocumentIds: [fixture.current.sourceDocumentId],
        ledgerEntryIds: [fixture.currentEntries[0]!.id],
        amount: "20.00",
      });

      const stored = await storedSuggestion(fixture.current.sourceDocumentId);
      expect(stored?.duplicateSuggestion).toBeNull();
    });
  });
});
