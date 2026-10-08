import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestBooks,
  createTestLedger,
} from "tests/helpers/schema-setup";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  extractionAttempts,
  sourceDocuments,
} from "@/persistence";
import { queryEnhancedStats } from "@/modules/stats/server/enhanced-stats-query";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

async function getTargetEnhancedStatsQuery(
  input: Parameters<typeof queryEnhancedStats>[0]
): ReturnType<typeof queryEnhancedStats> {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({ columns: { id: true } });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return queryEnhancedStats(input);
}

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first == null) {
    throw new Error(`Expected ${label}`);
  }
  return first;
}

describe("queryEnhancedStats", () => {
  let categoryId = "";

  beforeEach(async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const insertedCategories = await db
      .insert(entryCategories)
      .values({
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();
    categoryId = requireFirst(insertedCategories, "category").id;
  });

  it("converts mixed currencies by effective date using ledger main currency", async () => {
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "CNY" });

    await insertExchangeRates("2024-03-01", { USD: 2, CNY: 4 });
    await insertExchangeRates("2024-03-02", { USD: 2, CNY: 4 });

    const insertedDocs = await db
      .insert(sourceDocuments)
      .values([
        {
          documentDate: "2024-03-01",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          documentDate: "2024-03-02",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();

    const firstDoc = requireFirst(insertedDocs, "first document");
    const secondDoc = insertedDocs[1];
    if (secondDoc == null) {
      throw new Error("Expected second document");
    }

    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: firstDoc.id,
        amount: "20",
        currency: "USD",
        itemName: "USD item",
        categoryId,
      },
      {
        sourceDocumentId: secondDoc.id,
        amount: "30",
        currency: "CNY",
        itemName: "CNY item",
        categoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.currency).toBe("CNY");
    expect(result.summary.total).toBe("70");
    expect(result.summary.comparison).toMatchObject({
      mode: "same_period",
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(result.chart).toEqual([
      { date: "2024-03-01", total: "40" },
      { date: "2024-03-02", total: "30" },
    ]);
    // Nothing was recorded in February, so the comparison series is empty
    // rather than echoing the current window back.
    expect(result.previousChart).toEqual([]);
  });

  it("counts active projections even while the document is pending", async () => {
    const db = getTestDb();

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2024-03-12",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values({
      sourceDocumentId: doc.id,
      amount: "55",
      currency: "CNY",
      itemName: "pending reprocess item",
      categoryId,
    });
    // Activate the projection, then simulate an in-flight reprocessing pass
    // that leaves the previous active projection in place.
    await activateTestSourceDocumentProjection(db, doc.id);
    const [latestSubmission] = await db
      .insert(extractionAttempts)
      .values({
        sourceDocumentId: doc.id,
        status: "processing",
      })
      .returning({ id: extractionAttempts.id });
    await db
      .update(sourceDocuments)
      .set({ latestAttemptId: latestSubmission!.id })
      .where(eq(sourceDocuments.id, doc.id));

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.total).toBe("55");
  });

  it("excludes entries when rates are missing", async () => {
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "USD" });

    await insertExchangeRates("2024-04-01", { CNY: 7.8 });

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2024-04-01",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: doc.id,
        amount: "50",
        currency: "JPY",
        itemName: "missing rate",
        categoryId,
      },
      {
        sourceDocumentId: doc.id,
        amount: "25",
        currency: "USD",
        itemName: "main currency",
        categoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-04-01", to: "2024-04-30" },
      compareRange: { from: "2024-03-01", to: "2024-03-31" },
    });

    expect(result.summary.currency).toBe("USD");
    expect(result.summary.total).toBe("25");
    expect(result.unconvertedCount).toBe(1);
  });

  it("defaults summary currency to CNY when ledger main currency is absent", async () => {
    const db = getTestDb();

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2024-05-01",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values({
      sourceDocumentId: doc.id,
      amount: "10",
      currency: "CNY",
      itemName: "default currency item",
      categoryId,
    });

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-05-01", to: "2024-05-31" },
      compareRange: { from: "2024-04-01", to: "2024-04-30" },
    });

    expect(result.summary.currency).toBe("CNY");
    expect(result.summary.total).toBe("10");
  });

  it("computes heatmap p80Amount using zero-based percentile indexing", async () => {
    const db = getTestDb();
    const dailyAmounts = [10, 20, 30, 40, 50];

    for (const [index, amount] of dailyAmounts.entries()) {
      const day = String(index + 1).padStart(2, "0");
      const [doc] = await db
        .insert(sourceDocuments)
        .values({
          documentDate: `2024-06-${day}`,
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        })
        .returning();

      await db.insert(ledgerEntries).values({
        sourceDocumentId: doc!.id,
        amount: String(amount),
        currency: "CNY",
        itemName: `item-${day}`,
        categoryId,
      });
    }

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-06-01", to: "2024-06-30" },
      compareRange: { from: "2024-05-01", to: "2024-05-31" },
    });

    expect(result.heatmap.stats.p80Amount).toBe("40");
  });

  it("aggregates multiple entries with the same date, category, and currency", async () => {
    const db = getTestDb();

    // Create a second category to exercise multiple aggregate groups on the same date
    const insertedSecondCategory = await db
      .insert(entryCategories)
      .values({
        name: "交通",
        sortOrder: 2,
      })
      .returning();
    const secondCategoryId = requireFirst(insertedSecondCategory, "second category").id;

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2024-07-01",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();

    await db.insert(ledgerEntries).values([
      // 3 entries with first category
      {
        sourceDocumentId: doc!.id,
        amount: "100",
        currency: "CNY",
        itemName: "item 1",
        categoryId,
      },
      {
        sourceDocumentId: doc!.id,
        amount: "200",
        currency: "CNY",
        itemName: "item 2",
        categoryId,
      },
      {
        sourceDocumentId: doc!.id,
        amount: "300",
        currency: "CNY",
        itemName: "item 3",
        categoryId,
      },
      // 2 entries with second category (different aggregate group, same date)
      {
        sourceDocumentId: doc!.id,
        amount: "50",
        currency: "CNY",
        itemName: "item 4",
        categoryId: secondCategoryId,
      },
      {
        sourceDocumentId: doc!.id,
        amount: "150",
        currency: "CNY",
        itemName: "item 5",
        categoryId: secondCategoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-07-01", to: "2024-07-31" },
      compareRange: { from: "2024-06-01", to: "2024-06-30" },
    });

    expect(result.summary.total).toBe("800");

    expect(result.categories).toHaveLength(2);

    const primaryCategory = result.categories.find((c) => c.id === categoryId);
    const secondaryCategory = result.categories.find((c) => c.id === secondCategoryId);

    // Counts are numbers, not numeric strings: toMatchObject compares them strictly.
    expect(primaryCategory).toMatchObject({ count: 3, totalConverted: "600" });
    expect(secondaryCategory).toMatchObject({ count: 2, totalConverted: "200" });

    expect(result.chart).toHaveLength(1);
    expect(result.chart[0]?.date).toBe("2024-07-01");
    expect(result.chart[0]?.total).toBe("800");

    expect(result.heatmap.days).toHaveLength(1);

    // Strict numeric type assertion on heatmap entry count
    expect(typeof result.heatmap.days[0]!.entryCount).toBe("number");
    expect(result.heatmap.days[0]?.entryCount).toBe(5); // 3 + 2 across aggregate groups
    expect(result.heatmap.days[0]?.totalAmount).toBe("800");
    expect(result.heatmap.days[0]?.currencies).toEqual(["CNY"]);

    expect(result.heatmap.stats.minAmount).toBe("800");
    expect(result.heatmap.stats.maxAmount).toBe("800");
  });

  it("keeps full numeric precision beyond Number.MAX_SAFE_INTEGER", async () => {
    const db = getTestDb();
    const hugeA = "9007199254740993"; // 2^53 + 1
    const hugeB = "9007199254740994"; // 2^53 + 2

    const insertedSecondCategory = await db
      .insert(entryCategories)
      .values({
        name: "大额",
        sortOrder: 9,
      })
      .returning();
    const secondCategoryId = requireFirst(insertedSecondCategory, "second category").id;

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        documentDate: "2024-08-01",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: doc.id,
        amount: hugeA,
        currency: "CNY",
        itemName: "huge A",
        categoryId,
      },
      {
        sourceDocumentId: doc.id,
        amount: hugeB,
        currency: "CNY",
        itemName: "huge B",
        categoryId: secondCategoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      queryRange: { from: "2024-08-01", to: "2024-08-31" },
      compareRange: { from: "2024-07-01", to: "2024-07-31" },
    });

    expect(result.summary.total).toBe("18014398509481987");
    expect(result.summary.comparison.amountDelta).toBe("18014398509481987");
    // Decimal sort keeps the truly larger category first.
    expect(result.categories.map((category) => category.totalConverted)).toEqual([hugeB, hugeA]);
    expect(result.categories[0]?.trend.amount).toBe(hugeB);
  });

  describe("a running period", () => {
    async function recordOn(
      date: string,
      entries: { amount: string; currency?: string; itemName: string }[],
      bookId?: string
    ) {
      const db = getTestDb();
      const [doc] = await db
        .insert(sourceDocuments)
        .values({
          documentDate: date,
          bookId: bookId ?? sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      await db.insert(ledgerEntries).values(
        entries.map((entry) => ({
          sourceDocumentId: doc!.id,
          amount: entry.amount,
          currency: entry.currency ?? "CNY",
          itemName: entry.itemName,
          categoryId,
        }))
      );
      return doc!.id;
    }

    const runningMarch = {
      queryRange: { from: "2024-03-01", to: "2024-03-10" },
      compareRange: { from: "2024-02-01", to: "2024-02-10" },
      comparisonMode: "same_period" as const,
      periodEnd: "2024-03-31",
      previousWholeTo: "2024-02-29",
    };

    it("compares totals over the same days and charts the previous month whole", async () => {
      await recordOn("2024-02-05", [{ amount: "40", itemName: "early February" }]);
      await recordOn("2024-02-20", [{ amount: "900", itemName: "late February" }]);
      await recordOn("2024-03-05", [{ amount: "60", itemName: "March" }]);

      const result = await getTargetEnhancedStatsQuery(runningMarch);

      expect(result.periodEnd).toBe("2024-03-31");
      expect(result.summary.comparison).toMatchObject({
        previousTotal: "40",
        amountDelta: "20",
        wholeTo: "2024-02-29",
        previousWholeTotal: "940",
      });
      expect(result.previousChart).toEqual([
        { date: "2024-02-05", total: "40" },
        { date: "2024-02-20", total: "900" },
      ]);
      // A category's change is measured over the same days as the total's.
      expect(result.categories[0]?.trend.amount).toBe("20");
    });

    it("lists the biggest entries by converted amount and leaves out refunds and unrated ones", async () => {
      const db = getTestDb();
      await db.update(ledgers).set({ mainCurrency: "CNY" });
      await insertExchangeRates("2024-03-03", { USD: 1, CNY: 7 });
      const deposit = await recordOn("2024-03-03", [
        { amount: "500", currency: "USD", itemName: "deposit" },
        { amount: "-20", itemName: "refund" },
      ]);
      await recordOn("2024-03-04", [
        { amount: "80", itemName: "groceries" },
        { amount: "9999", currency: "JPY", itemName: "no rate" },
      ]);
      for (const day of ["05", "06", "07", "08", "09"]) {
        await recordOn(`2024-03-${day}`, [{ amount: "10", itemName: `coffee ${day}` }]);
      }
      await recordOn("2024-02-15", [{ amount: "5000", itemName: "last month" }]);

      const result = await getTargetEnhancedStatsQuery(runningMarch);

      expect(result.largestEntries.map((entry) => entry.name)).toEqual([
        "deposit",
        "groceries",
        "coffee 09",
        "coffee 08",
        "coffee 07",
      ]);
      expect(result.largestEntries[0]).toMatchObject({
        sourceDocumentId: deposit,
        categoryName: "餐饮",
        date: "2024-03-03",
        amount: "3500",
        originalAmount: "500",
        originalCurrency: "USD",
      });
    });

    it("keeps the biggest entries to the book asked for", async () => {
      const db = getTestDb();
      const travel = (await createTestBooks(db, ["旅行"])).get("旅行")!;
      await recordOn("2024-03-02", [{ amount: "70", itemName: "home" }]);
      await recordOn("2024-03-03", [{ amount: "700", itemName: "flight" }], travel);

      const all = await getTargetEnhancedStatsQuery(runningMarch);
      expect(all.largestEntries.map((entry) => entry.name)).toEqual(["flight", "home"]);

      const travelOnly = await getTargetEnhancedStatsQuery({
        ...runningMarch,
        bookId: travel,
      });
      expect(travelOnly.largestEntries.map((entry) => entry.name)).toEqual(["flight"]);
    });
  });
});
