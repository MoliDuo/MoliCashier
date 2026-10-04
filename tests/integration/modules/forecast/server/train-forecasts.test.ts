import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestBooks } from "tests/helpers/schema-setup";
import { createLedgerData } from "tests/helpers/factories";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getPeriodForecast } from "@/modules/forecast/server/get-forecast";
import { addCivilDays } from "@/modules/ledger/domain/period";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";

// The daily run also sweeps object storage; an empty bucket keeps it off the network.
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => new MemoryObjectStore() }));

import { runDailyMaintenance } from "@/server/maintenance/daily";

const THIS_MONTH = { range: "month", offset: 0 } as const;

describe("the nightly forecast training", () => {
  beforeEach(async () => {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData({ timeZone: "Asia/Shanghai" }));
    const books = await createTestBooks(db, ["共同支出"]);
    const [food, home] = await db
      .insert(entryCategories)
      .values([
        { name: "餐饮", icon: "utensils", sortOrder: 1 },
        { name: "居住", icon: "house", sortOrder: 2 },
      ])
      .returning({ id: entryCategories.id });

    const record = async (date: string, amount: string, categoryId: string, title: string) => {
      const [document] = await db
        .insert(sourceDocuments)
        .values({ documentDate: date, bookId: books.get("共同支出")!, title })
        .returning({ id: sourceDocuments.id });
      await db.insert(ledgerEntries).values({
        sourceDocumentId: document!.id,
        amount,
        currency: "CNY",
        itemName: title,
        categoryId,
      });
    };

    // Four months of food, ¥20 to ¥40 a day, and the rent on the 15th of each month.
    for (let day = 0; day < 120; day++) {
      const date = addCivilDays("2026-06-11", day);
      await record(date, String(20 + (day % 5) * 5), food!.id, "楼下的面馆");
      if (date.endsWith("-15")) await record(date, "1200", home!.id, "房租");
    }

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T04:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trains every scope as a daily step, and the forecast then says how it was chosen", async () => {
    const outcomes = await runDailyMaintenance({ now: new Date() });
    expect(outcomes.forecast_models).toBe("done");

    const forecast = await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");

    expect(forecast!.model).toMatchObject({ trainedFor: "2026-10-10" });
    const accuracy = forecast!.model!.accuracy!;
    expect(accuracy.origins).toBeGreaterThanOrEqual(2);
    expect(accuracy.horizonDays).toBe(14);
    expect(accuracy.error).toBeGreaterThanOrEqual(0);
    expect(forecast!.model!.networkShare).toBeGreaterThanOrEqual(0);
    expect(forecast!.model!.networkShare).toBeLessThan(1);
    // The rent came back on the 15th four times running, so it is expected again.
    expect(forecast!.upcoming).toEqual([
      expect.objectContaining({
        date: "2026-10-15",
        label: "房租",
        name: "居住",
        amount: "1200.00",
        cadence: "monthly",
        streak: 4,
      }),
    ]);
    expect(forecast!.anomalies).toEqual([]);
  });
});
