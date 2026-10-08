import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers, ledgerEntries, entryCategories } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  todayUtc,
} from "tests/helpers/schema-setup";
import { must } from "tests/helpers/must";

async function seedDoc(db: ReturnType<typeof getTestDb>, entryDate?: string) {
  const [docRow] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      documentDate: entryDate ?? todayUtc(),
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  const doc = must(docRow, "doc");
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

async function listTargetLedgerEntries(input: Parameters<typeof listLedgerEntries>[0]) {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    columns: { id: true },
  });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return listLedgerEntries(input);
}

describe("listLedgerEntries", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values({});
    await ensureTestLedgerBooks(db);
  });

  it("returns paginated entries", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);

    for (let i = 0; i < 5; i++) {
      await db.insert(ledgerEntries).values({
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: `Item ${i}`,
        amount: "10.00",
        currency: "CNY",
      });
    }

    const result = await listTargetLedgerEntries({ limit: 3 });
    expect(result.items).toHaveLength(3);
    const cursor = must(result.nextCursor, "next cursor");

    const rest = await listTargetLedgerEntries({ limit: 3, cursor });
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    const firstPageIds = new Set(result.items.map((item) => item.id));
    expect(rest.items.some((item) => firstPageIds.has(item.id))).toBe(false);
  });

  it("paginates same-day same-timestamp documents without duplicates or gaps", async () => {
    const db = getTestDb();
    const createdAt = new Date("2026-05-15T08:00:00.000Z");
    const entriesByDoc: Array<{ a: string; b: string }> = [];

    for (let i = 0; i < 3; i++) {
      const doc = await seedDoc(db, "2026-05-15");
      await db.update(sourceDocuments).set({ createdAt }).where(eq(sourceDocuments.id, doc.id));
      const [a, b] = await db
        .insert(ledgerEntries)
        .values([
          {
            id: randomUUID(),
            sourceDocumentId: doc.id,
            itemName: `A-${i}`,
            amount: "10.00",
            currency: "CNY",
          },
          {
            id: randomUUID(),
            sourceDocumentId: doc.id,
            itemName: `B-${i}`,
            amount: "20.00",
            currency: "CNY",
          },
        ])
        .returning();
      if (a == null || b == null) {
        throw new Error("Expected two ledger entries per document");
      }
      entriesByDoc.push({ a: a.id, b: b.id });
    }

    const collected: string[] = [];
    let cursor: string | null | undefined;
    for (let pageNum = 0; pageNum < 10; pageNum++) {
      const result = await listTargetLedgerEntries({
        cursor: cursor ?? undefined,
        limit: 2,
      });
      collected.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      if (cursor == null) break;
    }

    expect(collected).toHaveLength(6);
    expect(new Set(collected).size).toBe(6);
    // Within each document, position 0 must sort before position 1.
    for (const { a, b } of entriesByDoc) {
      const aIndex = collected.indexOf(a);
      const bIndex = collected.indexOf(b);
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(bIndex).toBeGreaterThan(aIndex);
    }
  });

  it("rejects a cursor whose fingerprint does not match the query", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);
    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "First",
        amount: "10.00",
        currency: "CNY",
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Second",
        amount: "20.00",
        currency: "CNY",
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Third",
        amount: "30.00",
        currency: "CNY",
      },
    ]);

    const firstPage = await listTargetLedgerEntries({ limit: 2 });
    const cursor = must(firstPage.nextCursor, "next cursor on the first page");

    await expect(
      listTargetLedgerEntries({
        cursor,
        categoryId: randomUUID(),
      })
    ).rejects.toThrow("Ledger entry cursor does not match the query");
  });

  it("filters by categoryId", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db);
    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Categorized",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Uncategorized",
        amount: "20.00",
        currency: "CNY",
      },
    ]);

    const result = await listTargetLedgerEntries({ categoryId: catId });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemName: "Categorized" });
  });

  it("filters uncategorized entries when using the __uncategorized__ sentinel", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db);

    await db.insert(ledgerEntries).values({
      id: randomUUID(),
      sourceDocumentId: doc.id,
      itemName: "Categorized",
      amount: "10.00",
      currency: "CNY",
      categoryId: catId,
    });

    const [uncategorizedEntryRow] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Uncategorized",
        amount: "20.00",
        currency: "CNY",
      })
      .returning();
    const uncategorizedEntry = must(uncategorizedEntryRow, "uncategorizedEntry");

    const result = await listTargetLedgerEntries({
      categoryId: UNCATEGORIZED_SENTINEL,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(uncategorizedEntry.id);
  });

  it("filters by currency", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);
    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "CNY item",
        amount: "10.00",
        currency: "CNY",
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "USD item",
        amount: "20.00",
        currency: "USD",
      },
    ]);

    const result = await listTargetLedgerEntries({ currency: "USD" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemName: "USD item" });
  });

  it("filters by date range via sourceDocument.entryDate", async () => {
    const db = getTestDb();
    const doc1 = await seedDoc(db, "2024-01-01");
    const doc2 = await seedDoc(db, "2024-06-01");
    const doc3 = await seedDoc(db, "2024-12-01");

    for (const [doc, name] of [
      [doc1, "Jan"],
      [doc2, "Jun"],
      [doc3, "Dec"],
    ] as const) {
      await db.insert(ledgerEntries).values({
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: name,
        amount: "10.00",
        currency: "CNY",
      });
    }

    const result = await listTargetLedgerEntries({
      startDate: "2024-02-01",
      endDate: "2024-11-01",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemName: "Jun" });
  });

  it("filters by entryDate not createdAt", async () => {
    const db = getTestDb();

    // Create doc with entryDate in Jan but created in March
    const [docARow] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        documentDate: "2024-01-15",
        createdAt: new Date("2024-03-01"),
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const docA = must(docARow, "docA");

    // Create doc with entryDate in March but created in January
    const [docBRow] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        documentDate: "2024-03-15",
        createdAt: new Date("2024-01-01"),
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const docB = must(docBRow, "docB");

    await db.insert(ledgerEntries).values({
      id: randomUUID(),
      sourceDocumentId: docA.id,
      itemName: "Jan Item",
      amount: "10.00",
      currency: "CNY",
    });

    await db.insert(ledgerEntries).values({
      id: randomUUID(),
      sourceDocumentId: docB.id,
      itemName: "Mar Item",
      amount: "10.00",
      currency: "CNY",
    });

    // Filter for January 2024
    const result = await listTargetLedgerEntries({
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });

    // Should only return entry from docA (entryDate in January)
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemName: "Jan Item" });
  });

  it("filters by minAmount and maxAmount", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db);
    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Cheap",
        amount: "10.00",
        currency: "CNY",
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Mid",
        amount: "50.00",
        currency: "CNY",
      },
      {
        id: randomUUID(),
        sourceDocumentId: doc.id,
        itemName: "Expensive",
        amount: "200.00",
        currency: "CNY",
      },
    ]);

    const result = await listTargetLedgerEntries({
      minAmount: "20",
      maxAmount: "100",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ itemName: "Mid" });
  });

  it("bounds foreign entries by their amount at the document day's rate", async () => {
    const db = getTestDb();
    // 1 USD is 7.2 / 1.1 = 6.545… CNY on this day; the earlier day has no rate.
    await insertExchangeRates("2024-01-15", { USD: "1.1", CNY: "7.2" });
    const ratedDoc = await seedDoc(db, "2024-01-15");
    const unratedDoc = await seedDoc(db, "2023-06-01");
    const entry = (sourceDocumentId: string, itemName: string, amount: string) => ({
      id: randomUUID(),
      sourceDocumentId,
      itemName,
      amount,
      currency: "USD",
    });
    await db
      .insert(ledgerEntries)
      .values([
        entry(ratedDoc.id, "Within", "10.00"),
        entry(ratedDoc.id, "Above", "20.00"),
        entry(unratedDoc.id, "Unrated", "10.00"),
      ]);
    const bounds = { minAmount: "20", maxAmount: "100" };

    const listed = await listTargetLedgerEntries(bounds);
    const totals = await calculateLedgerStats(bounds);

    expect(listed.items.map((item) => item.itemName)).toEqual(["Within"]);
    expect(totals.totals).toEqual([
      expect.objectContaining({ currency: "USD", count: 1, total: "10" }),
    ]);
  });

  it("rejects a page size it cannot serve", async () => {
    await expect(listLedgerEntries({ limit: 0 })).rejects.toThrow("Validation failed");
  });

  it("lists exactly the entries the totals count for the same filtered window", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({ id: catId, name: "餐饮", sortOrder: 1 });
    const doc = await seedDoc(db, "2026-03-10");
    const entry = (itemName: string, amount: string, currency = "CNY", categoryId?: string) => ({
      id: randomUUID(),
      sourceDocumentId: doc.id,
      itemName,
      amount,
      currency,
      categoryId: categoryId ?? null,
    });
    const [beans] = await db
      .insert(ledgerEntries)
      .values(entry("Coffee beans", "30.00"))
      .returning({ id: ledgerEntries.id });
    await db
      .insert(ledgerEntries)
      .values([
        entry("Coffee", "20.00", "CNY", catId),
        entry("Tea", "5.00"),
        entry("Coffee", "7.00", "USD"),
        entry("Coffee filter", "300.00"),
      ]);
    const window = {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      categoryId: UNCATEGORIZED_SENTINEL,
      currency: "CNY",
      minAmount: "10",
      maxAmount: "100",
      search: "  coffee  ",
    };

    const listed = await listTargetLedgerEntries({ ...window, limit: 20 });
    const totals = await calculateLedgerStats(window);

    expect(listed.items.map((item) => item.id)).toEqual([beans!.id]);
    expect(totals.totals).toEqual([
      expect.objectContaining({ currency: "CNY", count: 1, total: "30" }),
    ]);
  });
});
