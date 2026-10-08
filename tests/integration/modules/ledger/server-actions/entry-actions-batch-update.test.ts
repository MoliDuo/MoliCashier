import { sql } from "drizzle-orm";
import { getBatchEntryDateImpact } from "@/modules/ledger/server/entry-reads/get-batch-entry-date-impact";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers, ledgerEntries, entryCategories } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";

const { ensureRatesMock } = vi.hoisted(() => ({
  ensureRatesMock: vi.fn(async (_dates: readonly (string | null)[]) => undefined),
}));

vi.mock("@/modules/currency/server/exchange-rates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/currency/server/exchange-rates")>()),
  ensureExchangeRates: ensureRatesMock,
}));
import {
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
} from "@/modules/ledger/server-actions/entries";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  todayUtc,
} from "tests/helpers/schema-setup";

async function seedDoc(db: ReturnType<typeof getTestDb>, entryDate?: string) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      documentDate: entryDate ?? todayUtc(),
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

describe("batchUpdateLedgerEntriesAction", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values({
      id: randomUUID(),
    });
    await ensureTestLedgerBooks(db);
  });

  it("batch updates categoryId for multiple entries", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db);
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      const [e] = await db
        .insert(ledgerEntries)
        .values({
          id: randomUUID(),
          sourceDocumentId: doc.id,
          itemName: `Item ${i}`,
          amount: "10.00",
          currency: "CNY",
        })
        .returning();
      expect(e).toBeDefined();
      if (e === undefined) {
        throw new Error("Expected ledger entry insert to return a row");
      }
      ids.push(e.id);
    }
    await activateTestSourceDocumentProjection(db, doc.id);

    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    await batchUpdateLedgerEntriesAction([doc.id], ids, { categoryId: catId });
    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });

    // Manual edits update the entries in place and bump the version.
    expect(after?.version).toBe(before!.version + 1);

    for (const id of ids) {
      const entry = await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, id),
      });
      expect(entry?.categoryId).toBe(catId);
    }
  });

  it("changes only the fields a batch names", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({ id: catId, name: "餐饮", sortOrder: 1 });
    const doc = await seedDoc(db);
    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Lunch",
        amount: "10.00",
        currency: "USD",
        categoryId: catId,
        description: "with a friend",
      })
      .returning({ id: ledgerEntries.id });
    await activateTestSourceDocumentProjection(db, doc.id);

    await batchUpdateLedgerEntriesAction([doc.id], [entry!.id], { amount: "9.99" });

    await expect(
      db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entry!.id) })
    ).resolves.toMatchObject({
      amount: "9.990",
      itemName: "Lunch",
      currency: "USD",
      categoryId: catId,
      description: "with a friend",
    });
  });

  it("removes categories from entries when given categoryId null", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db);
    const ids: string[] = [];

    for (let i = 0; i < 2; i++) {
      const [e] = await db
        .insert(ledgerEntries)
        .values({
          id: randomUUID(),
          sourceDocumentId: doc.id,
          itemName: `Item ${i}`,
          amount: "10.00",
          currency: "CNY",
          categoryId: catId,
        })
        .returning();
      expect(e).toBeDefined();
      if (e === undefined) {
        throw new Error("Expected ledger entry insert to return a row");
      }
      ids.push(e.id);
    }
    await activateTestSourceDocumentProjection(db, doc.id);

    await batchUpdateLedgerEntriesAction([doc.id], ids, {
      categoryId: null,
    });

    for (const id of ids) {
      const entry = await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, id),
      });
      expect(entry?.categoryId).toBeNull();
    }
  });

  it("asks once for the rates of a batch moved to a foreign currency", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, "2026-09-01");
    const ids = (
      await db
        .insert(ledgerEntries)
        .values(
          Array.from({ length: 20 }, (_, index) => ({
            id: randomUUID(),
            sourceDocumentId: doc.id,
            itemName: `Converted ${index}`,
            amount: "10.00",
            currency: "CNY",
          }))
        )
        .returning({ id: ledgerEntries.id })
    ).map((entry) => entry.id);
    await activateTestSourceDocumentProjection(db, doc.id);
    ensureRatesMock.mockClear();

    await batchUpdateLedgerEntriesAction([doc.id], ids, {
      currency: "USD",
    });

    expect(ensureRatesMock).toHaveBeenCalledTimes(1);
    expect(new Set(ensureRatesMock.mock.calls[0]?.[0])).toEqual(new Set(["2026-09-01"]));
  });

  it("updates every targeted document even when one version has moved on", async () => {
    const db = getTestDb();
    const categoryId = randomUUID();
    await db.insert(entryCategories).values({
      id: categoryId,
      name: "Dining",
      sortOrder: 1,
    });
    const documents = await Promise.all([seedDoc(db), seedDoc(db)]);
    const entries = await Promise.all(
      documents.map(async (document, index) => {
        const [created] = await db
          .insert(ledgerEntries)
          .values({
            id: randomUUID(),
            sourceDocumentId: document.id,
            itemName: `Batch ${index}`,
            amount: "10.00",
            currency: "CNY",
          })
          .returning();
        await activateTestSourceDocumentProjection(db, document.id);
        return created!;
      })
    );
    await db
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, documents[1]!.id));

    const result = await batchUpdateLedgerEntriesAction(
      documents.map((document) => document.id),
      entries.map((entry) => entry.id),
      { categoryId }
    );

    expect(result).toEqual({
      ledgerEntryIds: entries.map((entry) => entry.id).sort(),
      affectedCount: 2,
    });
    const afterEntries = await db.query.ledgerEntries.findMany({
      where: inArray(
        ledgerEntries.id,
        entries.map((entry) => entry.id)
      ),
    });
    expect(afterEntries.every((entry) => entry.categoryId === categoryId)).toBe(true);
    const after = await db.query.sourceDocuments.findMany({
      where: inArray(
        sourceDocuments.id,
        documents.map((document) => document.id)
      ),
    });
    expect(new Map(after.map((document) => [document.id, document.version]))).toEqual(
      new Map([
        [documents[0]!.id, 2],
        [documents[1]!.id, 3],
      ])
    );
  });

  it("commits the date change and returns the locked impact", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, "2026-01-01");
    const ids = (
      await db
        .insert(ledgerEntries)
        .values([
          {
            id: randomUUID(),
            sourceDocumentId: doc.id,
            itemName: "First",
            amount: "10",
            currency: "CNY",
          },
          {
            id: randomUUID(),
            sourceDocumentId: doc.id,
            itemName: "Second",
            amount: "20",
            currency: "CNY",
          },
        ])
        .returning({ id: ledgerEntries.id })
    ).map((entry) => entry.id);
    await activateTestSourceDocumentProjection(db, doc.id);
    const preview = await getBatchEntryDateImpact({ ledgerEntryIds: [ids[0]!] });

    const committed = await batchUpdateLedgerEntryDatesAction([doc.id], [ids[0]!], "2026-01-02");

    expect(committed.impact).toEqual(preview);
    expect(committed.impact).toMatchObject({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 2,
      sourceDocumentIds: [doc.id],
    });
    const updatedDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    expect(updatedDocument?.documentDate).toBe("2026-01-02");
    expect(updatedDocument?.version).toBe(2);
  });
});
