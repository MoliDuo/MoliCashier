import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aiCorrections,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import {
  addLedgerEntry,
  batchDeleteLedgerEntries,
  batchUpdateLedgerEntries,
} from "@/modules/source-document/server/entry-commands";
import { updateSourceDocuments } from "@/modules/source-document/server/updates";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";

/** A record whose entries the AI wrote (`extracted`), and two categories to move between. */
async function createFixture(options: { extracted?: boolean } = {}) {
  const db = getTestDb();
  await createTestLedger(db);
  const [food, transport] = await db
    .insert(entryCategories)
    .values([
      { name: "餐饮", sortOrder: 1 },
      { name: "交通", sortOrder: 2 },
    ])
    .returning();
  const bookId = await testBookId(db);
  const record = await createTestRecord(db, {
    bookId,
    title: "STARBUCKS #123",
    entries: [
      {
        categoryId: food!.id,
        amount: "28.00",
        currency: "CNY",
        itemName: "Latte",
        description: null,
      },
      {
        categoryId: food!.id,
        amount: "6.00",
        currency: "CNY",
        itemName: "Cookie",
        description: null,
      },
    ],
  });
  const entries = await db.query.ledgerEntries.findMany({
    where: eq(ledgerEntries.sourceDocumentId, record.sourceDocumentId),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  if (options.extracted !== false) {
    await db.update(ledgerEntries).set({ extracted: true });
  }
  return {
    db,
    food: food!,
    transport: transport!,
    sourceDocumentId: record.sourceDocumentId,
    latte: entries[0]!,
    cookie: entries[1]!,
  };
}

const stored = () =>
  getTestDb().query.aiCorrections.findMany({
    orderBy: (row, { asc }) => [asc(row.field), asc(row.afterValue)],
  });

describe("recording the owner's corrections", () => {
  it("records a changed category with the AI's value, the new one and the entry as context", async () => {
    const fixture = await createFixture();

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      categoryId: fixture.transport.id,
    });

    expect(await stored()).toMatchObject([
      {
        sourceDocumentId: fixture.sourceDocumentId,
        subjectId: fixture.latte.id,
        field: "category",
        documentTitle: "STARBUCKS #123",
        itemName: "Latte",
        amount: "28.000",
        currency: "CNY",
        beforeValue: "餐饮",
        afterValue: "交通",
        consumedAt: null,
      },
    ]);
  });

  it("records each entry of a batch edit on its own", async () => {
    const fixture = await createFixture();

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id, fixture.cookie.id],
      categoryId: null,
    });

    const rows = await stored();
    expect(rows.map((row) => row.subjectId).sort()).toEqual(
      [fixture.latte.id, fixture.cookie.id].sort()
    );
    expect(rows.every((row) => row.afterValue === "")).toBe(true);
  });

  it("records a renamed item", async () => {
    const fixture = await createFixture();

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      itemName: "拿铁",
    });

    expect(await stored()).toMatchObject([
      { field: "item_name", beforeValue: "Latte", afterValue: "拿铁", itemName: "拿铁" },
    ]);
  });

  it("keeps the AI's value as the before across edits, and a later edit counts as new evidence", async () => {
    const fixture = await createFixture();
    const move = (categoryId: string) =>
      batchUpdateLedgerEntries({
        sourceDocumentIds: [fixture.sourceDocumentId],
        ledgerEntryIds: [fixture.latte.id],
        categoryId,
      });
    await move(fixture.transport.id);
    await fixture.db.update(aiCorrections).set({ consumedAt: new Date() });

    await move(fixture.food.id);
    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      categoryId: null,
    });

    expect(await stored()).toMatchObject([
      { beforeValue: "餐饮", afterValue: "", consumedAt: null },
    ]);
  });

  it("forgets the correction when the owner restores the AI's value", async () => {
    const fixture = await createFixture();
    const move = (categoryId: string) =>
      batchUpdateLedgerEntries({
        sourceDocumentIds: [fixture.sourceDocumentId],
        ledgerEntryIds: [fixture.latte.id],
        categoryId,
      });
    await move(fixture.transport.id);

    await move(fixture.food.id);

    expect(await stored()).toEqual([]);
  });

  it("does not record edits to entries the owner added, or to the amount, or a deletion", async () => {
    const fixture = await createFixture({ extracted: false });
    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      categoryId: fixture.transport.id,
      itemName: "拿铁",
    });
    expect(await stored()).toEqual([]);

    await fixture.db.update(ledgerEntries).set({ extracted: true });
    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.cookie.id],
      amount: "7.00",
      description: "note",
    });
    await batchDeleteLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.cookie.id],
    });
    await addLedgerEntry({
      sourceDocumentId: fixture.sourceDocumentId,
      amount: "3.00",
      itemName: "Napkin",
    });
    const [added] = await fixture.db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.itemName, "Napkin"),
    });
    expect(added?.extracted).toBe(false);
    expect(await stored()).toEqual([]);
  });

  it("records a title change only for a record the AI titled", async () => {
    const fixture = await createFixture();

    await updateSourceDocuments({
      sourceDocumentIds: [fixture.sourceDocumentId],
      data: { title: "星巴克" },
    });

    expect(await stored()).toMatchObject([
      {
        subjectId: fixture.sourceDocumentId,
        field: "title",
        beforeValue: "STARBUCKS #123",
        afterValue: "星巴克",
        itemName: null,
      },
    ]);
  });

  it("does not record a title change for a record the AI did not write entries for", async () => {
    const fixture = await createFixture({ extracted: false });

    await updateSourceDocuments({
      sourceDocumentIds: [fixture.sourceDocumentId],
      data: { title: "My own title" },
    });

    expect(await stored()).toEqual([]);
  });

  it("records a title change made together with a date change", async () => {
    const fixture = await createFixture();

    await updateSourceDocuments({
      sourceDocumentIds: [fixture.sourceDocumentId],
      data: { title: "星巴克", documentDate: "2026-08-03" },
    });

    expect(await stored()).toMatchObject([{ field: "title", afterValue: "星巴克" }]);
  });

  it("records nothing while learning is switched off", async () => {
    const fixture = await createFixture();
    await fixture.db.update(ledgers).set({ aiPreferenceLearningEnabled: false });

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      categoryId: fixture.transport.id,
    });
    await updateSourceDocuments({
      sourceDocumentIds: [fixture.sourceDocumentId],
      data: { title: "星巴克" },
    });

    expect(await stored()).toEqual([]);
  });

  it("goes with the record when it is deleted", async () => {
    const fixture = await createFixture();
    await batchUpdateLedgerEntries({
      sourceDocumentIds: [fixture.sourceDocumentId],
      ledgerEntryIds: [fixture.latte.id],
      categoryId: fixture.transport.id,
    });

    await deleteSourceDocumentAtomically({ sourceDocumentId: fixture.sourceDocumentId });

    expect(await stored()).toEqual([]);
    expect(
      await fixture.db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, fixture.sourceDocumentId),
      })
    ).toBeUndefined();
  });
});
