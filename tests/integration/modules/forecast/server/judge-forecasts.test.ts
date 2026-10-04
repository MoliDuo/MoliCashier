import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestBooks } from "tests/helpers/schema-setup";
import { createLedgerData } from "tests/helpers/factories";
import { fakeAiTransport, type FakeAiTransport } from "tests/helpers/fake-ai";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { setAiTransportForTests, type CompleteRequest } from "@/lib/ai/client";
import {
  entryCategories,
  forecastJudgments,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { getPeriodForecast } from "@/modules/forecast/server/get-forecast";
import { addCivilDays } from "@/modules/ledger/domain/period";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  FORECAST_AI_MAX_ATTEMPTS,
  FORECAST_AI_MAX_TOKENS,
  FORECAST_AI_REASONING_EFFORT,
  FORECAST_AI_TIMEOUT_MS,
} from "@/config/tuning";

// The daily run also sweeps object storage; an empty bucket keeps it off the network.
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => new MemoryObjectStore() }));

import { runDailyMaintenance } from "@/server/maintenance/daily";

const THIS_MONTH = { range: "month", offset: 0 } as const;

function digestOf(request: CompleteRequest): string {
  const content = request.messages.at(-1)!.content;
  return typeof content === "string" ? content : "";
}

/**
 * An analyst that reads the digest it is given as a person would: the
 * tuition is a semester's, the next one is expected in December, food runs
 * at ¥30 a day, and life changed on September 1st.
 */
function analyst(request: CompleteRequest): string {
  const digest = digestOf(request);
  if (!digest.startsWith("Today: ")) throw new Error("not a forecast judgment");
  const tuition = /\n(d\d+) \S+ 学费 /.exec(digest)?.[1];
  const food = /\n(c\d+) 餐饮/.exec(digest)![1];
  const education = /\n(c\d+) 教育/.exec(digest)![1];
  return JSON.stringify({
    phases: [
      { from: "2026-06-11", label: "在家" },
      { from: "2026-09-01", label: "读博" },
    ],
    documents: tuition == null ? [] : [{ ref: tuition, kind: "recurring", cadence: "semester" }],
    expected:
      tuition == null
        ? []
        : [
            {
              label: "学费",
              category: education,
              date: "2026-12-20",
              amount: 4000,
              cadence: "semester",
              basis: [tuition],
            },
          ],
    categories: [{ category: food, low: 25, mid: 30, high: 40, trend: "steady" }],
  });
}

describe("the AI analyst's nightly judgment", () => {
  let transport: FakeAiTransport;
  let record: (
    date: string,
    amount: string,
    category: "food" | "education",
    title: string
  ) => Promise<void>;

  beforeEach(async () => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("cashier.forecast.judgments")];
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData({ timeZone: "Asia/Shanghai" }));
    const books = await createTestBooks(db, ["共同支出"]);
    const [food, education] = await db
      .insert(entryCategories)
      .values([
        { name: "餐饮", icon: "utensils", sortOrder: 1 },
        { name: "教育", icon: "book", sortOrder: 2 },
      ])
      .returning({ id: entryCategories.id });
    const categories = { food: food!.id, education: education!.id };

    record = async (date, amount, category, title) => {
      const [document] = await db
        .insert(sourceDocuments)
        .values({ documentDate: date, bookId: books.get("共同支出")!, title })
        .returning({ id: sourceDocuments.id });
      await db.insert(ledgerEntries).values({
        sourceDocumentId: document!.id,
        amount,
        currency: "CNY",
        itemName: title,
        categoryId: categories[category],
      });
    };

    // ¥30 of food a day from June 11th through October 9th, and a semester's tuition on September 8th.
    for (let day = 0; day < 121; day++) {
      await record(addCivilDays("2026-06-11", day), "30", "food", "午饭");
    }
    await record("2026-09-08", "4000", "education", "学费");

    transport = fakeAiTransport(analyst);
    setAiTransportForTests(transport);
    // Noon on the 10th in Shanghai.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T04:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    setAiTransportForTests(null);
  });

  it("judges today and the past twelve weeks, and the forecast is computed from it", async () => {
    const outcomes = await runDailyMaintenance({ now: new Date() });
    expect(outcomes.forecast_judgments).toBe("done");

    const rows = await getTestDb()
      .select({ asOf: forecastJudgments.asOf, backfilled: forecastJudgments.backfilled })
      .from(forecastJudgments)
      .orderBy(asc(forecastJudgments.asOf));
    expect(rows).toHaveLength(13);
    // A reasoning model spends its reasoning from the same budget, so the request leaves room for it.
    expect(transport.complete.mock.calls[0]![0]).toMatchObject({
      maxTokens: FORECAST_AI_MAX_TOKENS,
      timeoutMs: FORECAST_AI_TIMEOUT_MS,
      maxAttempts: FORECAST_AI_MAX_ATTEMPTS,
      reasoningEffort: FORECAST_AI_REASONING_EFFORT,
    });
    expect(rows.at(-1)).toEqual({ asOf: "2026-10-10", backfilled: false });
    expect(rows[0]).toEqual({ asOf: "2026-07-18", backfilled: true });
    // A past day is judged from only what was recorded by then.
    const july = transport.complete.mock.calls
      .map(([request]) => digestOf(request))
      .find((digest) => digest.startsWith("Today: 2026-07-18."))!;
    expect(july).not.toContain("学费");
    expect(july).not.toContain("2026-07-19");

    const forecast = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;

    expect(forecast.judgment).toMatchObject({
      asOf: "2026-10-10",
      phases: [
        { from: "2026-06-11", to: "2026-08-31", label: "在家", daily: "30.00" },
        // The tuition is not everyday spending, so September's day stays at ¥30.
        { from: "2026-09-01", to: "2026-10-09", label: "读博", daily: "30.00" },
      ],
      documents: [],
    });
    // Nine days of ¥30, then twenty-one more.
    expect(forecast.spent).toBe("270");
    expect(forecast.categories).toEqual([
      expect.objectContaining({
        name: "餐饮",
        spent: "270",
        forecast: { p10: "795.00", p50: "900.00", p90: "1110.00" },
        trend: { direction: "steady", change: 0 },
      }),
    ]);
    expect(forecast.lifeChange).toEqual({
      date: "2026-09-01",
      dailyBefore: "30.00",
      dailyAfter: "30.00",
    });
    expect(forecast.largePurchaseFrom).toBeNull();
    expect(forecast.upcoming).toEqual([
      expect.objectContaining({
        date: "2026-12-20",
        label: "学费",
        name: "教育",
        amount: "4000.00",
        cadence: "semester",
        streak: null,
        seen: 1,
        inPeriod: false,
      }),
    ]);
    // Ten past days have had their fortnight; the two around the tuition missed it.
    expect(forecast.judgment!.accuracy).toMatchObject({ origins: 10, horizonDays: 14 });
    expect(forecast.judgment!.accuracy!.error).toBeGreaterThan(0);

    // A second night has nothing new to judge.
    const calls = transport.complete.mock.calls.length;
    await runDailyMaintenance({ now: new Date() });
    expect(transport.complete.mock.calls.length).toBe(calls);
  });

  it("judges again in the background once entries change and half an hour has passed", async () => {
    await runDailyMaintenance({ now: new Date() });
    const calls = transport.complete.mock.calls.length;
    await record("2026-10-10", "88", "food", "火锅");

    // Too soon after the last judgment: the page uses it, with the new spending counted.
    const soon = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;
    expect(soon.spent).toBe("358");
    expect(soon.judgment!.asOf).toBe("2026-10-10");
    expect(transport.complete.mock.calls.length).toBe(calls);

    vi.setSystemTime(new Date("2026-10-10T04:31:00Z"));
    await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");
    await vi.waitFor(() => expect(transport.complete.mock.calls.length).toBe(calls + 1));
    expect(digestOf(transport.complete.mock.calls.at(-1)![0])).toContain("火锅");
  });

  it("falls back to the statistical model when the AI cannot be reached", async () => {
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new AppError("provider down", "ai_provider_unavailable", 503);
      })
    );
    const warn = vi.spyOn(logger, "warn");

    const outcomes = await runDailyMaintenance({ now: new Date() });
    expect(outcomes.forecast_judgments).toBe("failed");
    expect(outcomes.forecast_models).toBe("done");
    // The log says why, by a code that survives the production build.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ step: "forecast_judgments", errorCode: "ai_provider_unavailable" }),
      "Daily maintenance step failed"
    );

    const forecast = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;
    expect(forecast.judgment).toBeNull();
    expect(forecast.categories[0]!.trend).toBeNull();
    expect(Number(forecast.total.p50)).toBeGreaterThan(270);
  });
});
