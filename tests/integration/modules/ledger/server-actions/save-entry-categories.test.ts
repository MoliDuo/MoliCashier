import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { SIGN_IN_PATH } from "@/modules/auth/constants";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
  extractionAttempts,
} from "@/persistence";
import { getTestDb } from "tests/setup";
import { createLedgerData, createSourceDocumentData } from "tests/helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

/** Saves a collection the test expects to be accepted, and returns what was saved. */
async function saveCategories(input: Parameters<typeof saveEntryCategoriesAction>[0]) {
  const result = await saveEntryCategoriesAction(input);
  if (!result.ok) throw new Error(`Expected the save to succeed, got ${result.code}`);
  return result.categories;
}

describe("saveEntryCategoriesAction", () => {
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(
      testSession({ email: "category-save@example.com" })
    );
  });

  it("commits additions, edits, deletions, and ordering in one transaction", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const keepId = crypto.randomUUID();
    const removeId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    const document = createSourceDocumentData();
    const entryId = crypto.randomUUID();

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values([
      { id: keepId, name: "Keep", sortOrder: 0 },
      { id: removeId, name: "Remove", sortOrder: 1 },
    ]);
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      sourceDocumentId: document.id,
      itemName: "Categorized",
      amount: "10.00",
      currency: "CNY",
      categoryId: removeId,
    });
    // Multiple affected entries must still advance their aggregate only once.
    await db.insert(ledgerEntries).values({
      id: crypto.randomUUID(),
      sourceDocumentId: document.id,
      itemName: "Second categorized item",
      amount: "5",
      currency: "CNY",
      categoryId: removeId,
    });
    await activateTestSourceDocumentProjection(db, document.id);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany()
    );

    const saved = await saveCategories({
      expectedRevision,
      categories: [
        {
          clientId: newId,
          name: "New",
          description: "Created in draft",
          icon: "circle",
        },
        {
          id: keepId,
          name: "Renamed",
          description: null,
          icon: null,
        },
      ],
    });

    expect(saved.map((category) => category.id)).toEqual([newId, keepId]);
    expect(saved.map((category) => category.sortOrder)).toEqual([0, 1]);
    expect(saved[1]?.name).toBe("Renamed");
    const removed = await db.query.entryCategories.findFirst({
      where: eq(entryCategories.id, removeId),
    });
    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(removed).toBeUndefined();
    expect(entry?.categoryId).toBeNull();
    // Clearing a deleted category leaves the document version alone.
    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
    ).toMatchObject({ version: 1 });
    expect(
      await batchUpdateSourceDocumentsAction({
        sourceDocumentIds: [document.id],
        data: { title: "Edited title" },
      })
    ).toMatchObject({ updatedCount: 1 });
    await saveCategories({
      expectedRevision: await computeCategoryCollectionRevision(saved),
      categories: saved.map(({ id, name, description, icon }) => ({ id, name, description, icon })),
    });
    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
    ).toMatchObject({ version: 2 });
  });

  it("rolls back the whole category draft when an affected document is processing", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    const categoryId = crypto.randomUUID();
    await db.insert(entryCategories).values({ id: categoryId, name: "Busy" });
    const documents = [createSourceDocumentData(), createSourceDocumentData()];
    for (const document of documents) {
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      });
      await db.insert(ledgerEntries).values({
        sourceDocumentId: document.id,
        categoryId,
        itemName: "Affected",
        amount: "10",
        currency: "CNY",
      });
      await activateTestSourceDocumentProjection(db, document.id);
      if (document === documents[1]) {
        const [attempt] = await db
          .insert(extractionAttempts)
          .values({
            sourceDocumentId: document.id,
            status: "processing",
          })
          .returning();
        await db
          .update(sourceDocuments)
          .set({ latestAttemptId: attempt!.id })
          .where(eq(sourceDocuments.id, document.id));
      }
    }
    const categories = await db.query.entryCategories.findMany();
    await expect(
      saveEntryCategoriesAction({
        expectedRevision: await computeCategoryCollectionRevision(categories),
        categories: [],
      })
    ).resolves.toEqual({ ok: false, code: "conflict" });
    expect(
      await db.query.entryCategories.findFirst({ where: eq(entryCategories.id, categoryId) })
    ).toBeDefined();
    const entries = await db.query.ledgerEntries.findMany();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.categoryId === categoryId)).toBe(true);
    const unchanged = await db.query.sourceDocuments.findMany();
    expect(unchanged.every((document) => document.version === 1)).toBe(true);
  });

  it("sends a signed-out session to sign in before saving a collection", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(
      saveEntryCategoriesAction({
        expectedRevision: await computeCategoryCollectionRevision([]),
        categories: [],
      })
    ).rejects.toMatchObject({ digest: expect.stringContaining(SIGN_IN_PATH) });
  });

  it("allows every category to be edited and deleted", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const editableId = crypto.randomUUID();
    const fixedId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values([
      { id: editableId, name: "Editable", sortOrder: 0 },
      {
        id: fixedId,
        name: "Fixed",
        sortOrder: 1,
      },
    ]);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany()
    );

    await expect(
      saveEntryCategoriesAction({
        expectedRevision,
        categories: [
          {
            id: editableId,
            name: "Changed",
            description: null,
            icon: null,
          },
        ],
      })
    ).resolves.toMatchObject({ ok: true, categories: [{ name: "Changed" }] });

    const active = await db.query.entryCategories.findMany({
      orderBy: entryCategories.sortOrder,
    });
    expect(active.map((category) => category.name)).toEqual(["Changed"]);
  });

  it("rejects a malformed collection before touching the categories", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values({ name: "Kept", sortOrder: 0 });

    await expect(
      saveEntryCategoriesAction({ expectedRevision: "invalid", categories: [] } as never)
    ).resolves.toEqual({ ok: false, code: "invalid" });
    await expect(db.query.entryCategories.findMany()).resolves.toEqual([
      expect.objectContaining({ name: "Kept" }),
    ]);
  });

  it("rejects a stale category collection revision without applying the draft", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const categoryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values({
      id: categoryId,
      name: "Original",
      sortOrder: 0,
    });
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany()
    );
    await db
      .update(entryCategories)
      .set({ name: "Changed elsewhere", updatedAt: new Date() })
      .where(eq(entryCategories.id, categoryId));

    await expect(
      saveEntryCategoriesAction({
        expectedRevision,
        categories: [{ id: categoryId, name: "Draft", description: null, icon: null }],
      })
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      db.query.entryCategories.findFirst({ where: eq(entryCategories.id, categoryId) })
    ).resolves.toMatchObject({ name: "Changed elsewhere" });
  });

  it("swaps two names and reuses a deleted category's name in one save", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const [aId, bId, goneId] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values([
      { id: aId, name: "A", sortOrder: 0 },
      { id: bId, name: "B", sortOrder: 1 },
      { id: goneId, name: "Gone", sortOrder: 2 },
    ]);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        orderBy: entryCategories.sortOrder,
      })
    );

    await saveCategories({
      expectedRevision,
      categories: [
        { id: aId, name: "B", description: null, icon: null },
        { id: bId, name: "Gone", description: null, icon: null },
        { clientId: crypto.randomUUID(), name: "A", description: null, icon: null },
      ],
    });

    const rows = await db.query.entryCategories.findMany({
      orderBy: entryCategories.sortOrder,
    });
    expect(
      rows.map((row) => [row.id === aId ? "a" : row.id === bId ? "b" : "new", row.name])
    ).toEqual([
      ["a", "B"],
      ["b", "Gone"],
      ["new", "A"],
    ]);
  });

  it("saves the maximum category batch while swapping every unique name", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const categories = Array.from({ length: 100 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `Category ${index}`,
      sortOrder: index,
    }));
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values(categories);
    const expectedRevision = await computeCategoryCollectionRevision(
      await db.query.entryCategories.findMany({
        orderBy: entryCategories.sortOrder,
      })
    );

    const saved = await saveCategories({
      expectedRevision,
      categories: categories.map((category, index) => ({
        id: category.id,
        name: `Category ${(index + 1) % categories.length}`,
        description: `Position ${index}`,
        icon: null,
      })),
    });

    expect(saved).toHaveLength(100);
    expect(saved.map((category) => category.name)).toEqual(
      Array.from({ length: 100 }, (_, index) => `Category ${(index + 1) % 100}`)
    );
    expect(saved.map((category) => category.sortOrder)).toEqual(
      Array.from({ length: 100 }, (_, index) => index)
    );
  });
});
