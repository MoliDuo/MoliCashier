import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { entryCategories, ledgerEntries, ledgers } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
  todayUtc,
} from "tests/helpers/schema-setup";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

async function seedEntry(
  db: ReturnType<typeof getTestDb>,
  opts: {
    amount: string;
    currency?: string;
    categoryId?: string;
    entryDate?: string;
  }
) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      documentDate: opts.entryDate ?? todayUtc(),
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }

  await db.insert(ledgerEntries).values({
    id: randomUUID(),
    sourceDocumentId: doc.id,
    itemName: "Test Item",
    amount: opts.amount,
    currency: opts.currency === undefined ? "CNY" : opts.currency,
    categoryId: opts.categoryId ?? null,
  });
  await activateTestSourceDocumentProjection(db, doc.id);

  return doc;
}

describe("calculateLedgerStats", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values({
      mainCurrency: "CNY",
    });
    await ensureTestLedgerBooks(db);
  });

  it("returns zero values for empty ledger", async () => {
    const result = await calculateLedgerStats({});
    expect(result.totals).toHaveLength(0);
    expect(result.trend).toHaveLength(0);
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.total).toBe("0");
    expect(result.convertedTotal?.currency).toBe("CNY");
  });

  it("groups totals by currency", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, { amount: "50.00", currency: "CNY" });
    await seedEntry(db, { amount: "20.00", currency: "USD" });

    const result = await calculateLedgerStats({});
    const cny = result.totals.find((t) => t.currency === "CNY");
    const usd = result.totals.find((t) => t.currency === "USD");

    expect(cny).toBeDefined();
    expect(cny!.total).toBe("150");
    expect(cny!.count).toBe(2);
    expect(usd).toBeDefined();
    expect(usd!.total).toBe("20");
    expect(usd!.count).toBe(1);
  });

  it("uses the persisted main currency for entries", async () => {
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "USD" });
    await seedEntry(db, {
      amount: "12.50",
      currency: "USD",
    });

    const result = await calculateLedgerStats({ currency: " usd " });

    expect(result.convertedTotal).toEqual({ total: "12.5", currency: "USD" });
    expect(result.totals).toEqual([{ currency: "USD", total: "12.5", count: 1 }]);
  });

  it("groups raw totals by category and effective currency", async () => {
    const db = getTestDb();
    const categoryId = randomUUID();
    await db.insert(entryCategories).values({
      id: categoryId,
      name: "Food",
      icon: "utensils",
      sortOrder: 1,
    });
    await seedEntry(db, {
      amount: "8.25",
      currency: "CNY",
      categoryId,
    });
    await seedEntry(db, {
      amount: "3.75",
      currency: "CNY",
      categoryId,
    });

    const result = await calculateLedgerStats({});

    expect(result.byCategory).toContainEqual({
      categoryId,
      categoryName: "Food",
      categoryIcon: "utensils",
      currency: "CNY",
      total: "12",
      count: 2,
    });
  });

  it("returns trend sorted by date", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "30.00", currency: "CNY", entryDate: "2024-01-03" });
    await seedEntry(db, { amount: "10.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, { amount: "20.00", currency: "CNY", entryDate: "2024-01-02" });

    const result = await calculateLedgerStats({});
    expect(result.trend).toHaveLength(3);
    const firstTrend = result.trend[0];
    const secondTrend = result.trend[1];
    const thirdTrend = result.trend[2];
    expect(firstTrend).toBeDefined();
    expect(secondTrend).toBeDefined();
    expect(thirdTrend).toBeDefined();
    expect(firstTrend?.date).toBe("2024-01-01");
    expect(secondTrend?.date).toBe("2024-01-02");
    expect(thirdTrend?.date).toBe("2024-01-03");
  });

  it("filters by startDate using the source document accounting date", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "100.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, { amount: "200.00", currency: "CNY", entryDate: "2024-02-01" });
    await seedEntry(db, { amount: "300.00", currency: "CNY", entryDate: "2024-03-01" });

    const result = await calculateLedgerStats({ startDate: "2024-02-01" });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(2);
    expect(cny!.total).toBe("500");
  });

  it("filters by endDate using the source document accounting date", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "100.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, { amount: "200.00", currency: "CNY", entryDate: "2024-02-01" });
    await seedEntry(db, { amount: "300.00", currency: "CNY", entryDate: "2024-03-01" });

    const result = await calculateLedgerStats({ endDate: "2024-02-01" });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(2);
    expect(cny!.total).toBe("300");
  });

  it("filters by categoryId", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      name: "餐饮",
      sortOrder: 1,
    });

    await seedEntry(db, { amount: "100.00", currency: "CNY", categoryId: catId });
    await seedEntry(db, { amount: "200.00", currency: "CNY" }); // no category

    const result = await calculateLedgerStats({
      categoryId: catId,
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("100");
  });

  it("filters by currency", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, { amount: "50.00", currency: "USD" });

    const result = await calculateLedgerStats({
      currency: "USD",
    });
    expect(result.totals).toHaveLength(1);
    const firstTotal = result.totals[0];
    expect(firstTotal).toBeDefined();
    expect(firstTotal?.currency).toBe("USD");
  });

  it("filters by minAmount using convertedAmount", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "50.00", currency: "CNY" });
    await seedEntry(db, { amount: "200.00", currency: "CNY" });

    const result = await calculateLedgerStats({
      minAmount: "100",
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("200");
  });

  it("filters by maxAmount using convertedAmount", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "50.00", currency: "CNY" });
    await seedEntry(db, { amount: "200.00", currency: "CNY" });

    const result = await calculateLedgerStats({
      maxAmount: "100",
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("50");
  });

  it("converts foreign entries at their document day's rate for convertedTotal", async () => {
    const db = getTestDb();
    await insertExchangeRates("2024-01-15", { USD: "1.1", CNY: "7.2" });
    // 110 USD at 7.2 / 1.1 CNY per USD is 720 CNY.
    await seedEntry(db, {
      amount: "110.00",
      currency: "USD",
      entryDate: "2024-01-15",
    });

    const result = await calculateLedgerStats({});
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.currency).toBe("CNY");
    expect(result.convertedTotal?.total).toBe("720");
  });

  it("excludes entries without a rate for their day from the main total but keeps original currency totals", async () => {
    const db = getTestDb();
    await seedEntry(db, {
      amount: "100.00",
      currency: "USD",
      entryDate: "2024-01-15",
    });
    await seedEntry(db, {
      amount: "50.00",
      currency: "CNY",
      entryDate: "2024-01-15",
    });

    const result = await calculateLedgerStats({});

    expect(result.convertedTotal?.total).toBe("50");
    expect(result.unconvertedCount).toBe(1);
    expect(result.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "USD", total: "100", count: 1 }),
        expect.objectContaining({ currency: "CNY", total: "50", count: 1 }),
      ])
    );
  });

  it("single currency ledger: convertedTotal equals sum of amounts", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, { amount: "50.00", currency: "CNY" });

    const result = await calculateLedgerStats({});
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.total).toBe("150");
    expect(result.convertedTotal?.currency).toBe("CNY");
  });

  it("executes the summary as a single SQL statement", async () => {
    const db = getTestDb();
    await seedEntry(db, { amount: "10.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, { amount: "20.00", currency: "USD", entryDate: "2024-01-02" });

    const dbWithClient = getTestDb() as unknown as {
      $client?: {
        query: (query: string | { text?: string }, ...args: unknown[]) => Promise<unknown>;
      };
    };
    const client = dbWithClient.$client;
    if (client == null) {
      throw new Error("Expected drizzle client to exist in integration tests");
    }
    const originalQuery = client.query.bind(client);
    const statements: string[] = [];
    client.query = ((query: string | { text?: string }, ...args: unknown[]) => {
      statements.push(typeof query === "string" ? query : (query.text ?? ""));
      return originalQuery(query, ...args);
    }) as typeof client.query;

    try {
      await calculateLedgerStats({});
    } finally {
      client.query = originalQuery;
    }

    const summaryStatements = statements
      .map((statement) => statement.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((statement) => statement.includes("visible_entries"));
    expect(summaryStatements).toHaveLength(1);
  });

  it("totals only uncategorized entries for the uncategorized sentinel", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({ id: catId, name: "餐饮", sortOrder: 1 });
    await seedEntry(db, { amount: "100.00", categoryId: catId });
    await seedEntry(db, { amount: "30.00" });

    const result = await calculateLedgerStats({ categoryId: "__uncategorized__" });

    expect(result.totals).toEqual([expect.objectContaining({ currency: "CNY", total: "30" })]);
  });

  it("refuses a query it cannot read instead of totalling something else", async () => {
    await expect(calculateLedgerStats({ minAmount: "abc" })).rejects.toThrow("Validation failed");
    // The internal flag is spelled by the sentinel on the wire, never directly.
    await expect(calculateLedgerStats({ uncategorizedOnly: true })).rejects.toThrow(
      "Validation failed"
    );
  });

  describe("conversion to the main currency", () => {
    it("converts every currency by the document day's rates", async () => {
      const db = getTestDb();
      await insertExchangeRates("2024-01-01", { CNY: 7.8, MYR: 5, USD: 1.08 });

      const [sourceDoc] = await db
        .insert(sourceDocuments)
        .values({
          documentDate: "2024-01-01",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      expect(sourceDoc).toBeDefined();
      if (sourceDoc == null) {
        throw new Error("Expected source document to be created");
      }

      await db.insert(ledgerEntries).values({
        sourceDocumentId: sourceDoc.id,
        amount: "100.00",
        currency: "MYR",
        itemName: "MYR Item",
      });

      await db.insert(ledgerEntries).values({
        sourceDocumentId: sourceDoc.id,
        amount: "50.00",
        currency: "USD",
        itemName: "USD Item",
      });

      await db.insert(ledgerEntries).values({
        sourceDocumentId: sourceDoc.id,
        amount: "100.00",
        currency: "CNY",
        itemName: "CNY Item",
      });
      await activateTestSourceDocumentProjection(db, sourceDoc.id);

      const stats = await calculateLedgerStats({});

      expect(stats.convertedTotal?.currency).toBe("CNY");
      expect(stats.convertedTotal?.total).toBeCloseTo(617.11, 1);
    });
  });
});
