import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestBooks } from "tests/helpers/schema-setup";
import { createLedgerData } from "tests/helpers/factories";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getPeriodForecast } from "@/modules/forecast/server/get-forecast";
import { addCivilDays } from "@/modules/ledger/domain/period";
import { setAiTransportForTests } from "@/lib/ai/client";
import { fakeAiTransport } from "tests/helpers/fake-ai";

const THIS_MONTH = { range: "month", offset: 0 } as const;

describe("getPeriodForecast", () => {
  let books = new Map<string, string>();

  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData({ timeZone: "Asia/Shanghai" }));
    books = await createTestBooks(db, ["共同支出", "旅行"]);
    const [food] = await db
      .insert(entryCategories)
      .values({ name: "餐饮", icon: "utensils", sortOrder: 1 })
      .returning({ id: entryCategories.id });

    const record = async (
      date: string,
      amount: string,
      currency: string,
      options: { categoryId?: string; book?: string } = {}
    ) => {
      const [document] = await db
        .insert(sourceDocuments)
        .values({ documentDate: date, bookId: books.get(options.book ?? "共同支出")! })
        .returning({ id: sourceDocuments.id });
      await db.insert(ledgerEntries).values({
        sourceDocumentId: document!.id,
        amount,
        currency,
        itemName: `${date} ${currency}`,
        categoryId: options.categoryId ?? null,
      });
    };

    // ¥30 of food every day from September 1st through October 9th.
    for (let day = 0; day < 39; day++) {
      await record(addCivilDays("2026-09-01", day), "30", "CNY", { categoryId: food!.id });
    }
    // RM 10 at 1.6 yuan to the ringgit on the 5th.
    await insertExchangeRates("2026-10-05", { MYR: 5, CNY: 8 });
    await record("2026-10-05", "10", "MYR", { categoryId: food!.id });
    // A dollar entry on a day with no rate is left out, as 统计 leaves it out.
    await record("2026-10-06", "99", "USD", { categoryId: food!.id });
    // A trip booked in the other book.
    await record("2026-10-02", "1000", "CNY", { book: "旅行" });

    // Noon on the 10th in Shanghai.
    // No AI analyst here: the statistical model answers, as it does when the provider is down.
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new Error("no AI in this test");
      })
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T04:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    setAiTransportForTests(null);
  });

  it("forecasts this month from the ledger's history, converted to the main currency", async () => {
    const forecast = await getPeriodForecast(
      { bookId: books.get("共同支出"), period: THIS_MONTH },
      "Asia/Shanghai"
    );

    expect(forecast).toMatchObject({
      asOf: "2026-10-10",
      periodEnd: "2026-10-31",
      currency: "CNY",
      historyFrom: "2026-09-01",
      halfLifeDays: 30,
      // Nine days of ¥30 and the ¥16 in ringgit.
      spent: "286",
      exceedPrevious: { total: "900" },
      // Five weeks of the same ¥30 a day: too few, and too even, to show a change.
      lifeChange: null,
    });
    expect(forecast!.running).toHaveLength(21);
    expect(forecast!.categories).toEqual([
      expect.objectContaining({ name: "餐饮", icon: "utensils", spent: "286" }),
    ]);
    // Twenty-one more days at ¥30, with one ¥46 day in the mix.
    const middle = Number(forecast!.total.p50);
    expect(middle).toBeGreaterThanOrEqual(286 + 21 * 30);
    expect(middle).toBeLessThanOrEqual(286 + 21 * 46);
    expect(forecast!.exceedPrevious!.probability).toBe(1);
  });

  it("reads every book together without one, an uncategorized trip included", async () => {
    const forecast = await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");

    expect(forecast!.spent).toBe("1286");
    expect(forecast!.categories.map((category) => [category.name, category.spent])).toEqual([
      [null, "1000"],
      ["餐饮", "286"],
    ]);
  });

  it("has nothing to say about a period that is not running, and refuses bad input", async () => {
    expect(
      await getPeriodForecast({ period: { range: "month", offset: -1 } }, "Asia/Shanghai")
    ).toBeNull();
    expect(await getPeriodForecast({ period: { range: "all" } }, "Asia/Shanghai")).toBeNull();
    await expect(
      getPeriodForecast({ period: THIS_MONTH, extra: 1 }, "Asia/Shanghai")
    ).rejects.toThrow("Validation failed");
  });
});
