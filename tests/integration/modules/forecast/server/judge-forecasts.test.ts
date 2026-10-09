import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
import { judgeForecasts } from "@/modules/forecast/server/judge-ledger";
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
const REGISTRY_KEY = Symbol.for("cashier.forecast.judgments");

/** Waits for any judgment a read started in the background. */
async function settleJudgments(): Promise<void> {
  const registry = (
    globalThis as Record<symbol, { running: Map<string, Promise<void>> } | undefined>
  )[REGISTRY_KEY];
  await Promise.allSettled(registry?.running.values() ?? []);
}

function digestOf(request: CompleteRequest): string {
  const content = request.messages.at(-1)!.content;
  return typeof content === "string" ? content : "";
}

/**
 * An analyst that reads the digest it is given as a person would: the
 * tuition is a semester's and the lamp a one-off, the next tuition is due in
 * December, and the term's books on October 20th.
 */
function analyst(request: CompleteRequest): string {
  const digest = digestOf(request);
  if (!digest.startsWith("Today: ")) throw new Error("not a forecast judgment");
  const tuition = /\n(d\d+) \S+ 学费 /.exec(digest)?.[1];
  const lamp = /\n(d\d+) \S+ 台灯 /.exec(digest)?.[1];
  const education = /\n(c\d+) 教育/.exec(digest)![1];
  return JSON.stringify({
    documents: [
      ...(tuition == null ? [] : [{ ref: tuition, kind: "recurring", cadence: "semester" }]),
      ...(lamp == null ? [] : [{ ref: lamp, kind: "one_off" }]),
    ],
    expected:
      tuition == null
        ? []
        : [
            {
              label: "教材",
              category: education,
              date: "2026-10-20",
              amount: 300,
              cadence: "semester",
              basis: [tuition],
            },
            {
              label: "学费",
              category: education,
              date: "2026-12-20",
              amount: 4000,
              cadence: "semester",
              basis: [tuition],
            },
          ],
  });
}

describe("the AI analyst's weekly judgment", () => {
  let transport: FakeAiTransport;
  let record: (
    date: string,
    amount: string,
    category: "food" | "education",
    title: string
  ) => Promise<void>;

  beforeEach(async () => {
    delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
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

    // ¥30 of food a day from June 11th through October 9th, a semester's tuition on September 8th,
    // and a ¥100 lamp filed under food on September 20th: too small for the statistical model to
    // take for a one-off.
    for (let day = 0; day < 121; day++) {
      await record(addCivilDays("2026-06-11", day), "30", "food", "午饭");
    }
    await record("2026-09-08", "4000", "education", "学费");
    await record("2026-09-20", "100", "food", "台灯");

    transport = fakeAiTransport(analyst);
    setAiTransportForTests(transport);
    // Noon on Saturday the 10th in Shanghai.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T04:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    setAiTransportForTests(null);
  });

  it("judges the ledger, and the forecast leaves out its one-offs and adds what it expects", async () => {
    const outcomes = await runDailyMaintenance({ now: new Date() });
    expect(outcomes.forecast_judgments).toBe("done");

    const rows = await getTestDb()
      .select({ asOf: forecastJudgments.asOf, backfilled: forecastJudgments.backfilled })
      .from(forecastJudgments);
    expect(rows).toEqual([{ asOf: "2026-10-10", backfilled: false }]);
    // A reasoning model spends its reasoning from the same budget, so the request leaves room for it.
    expect(transport.complete.mock.calls[0]![0]).toMatchObject({
      maxTokens: FORECAST_AI_MAX_TOKENS,
      timeoutMs: FORECAST_AI_TIMEOUT_MS,
      maxAttempts: FORECAST_AI_MAX_ATTEMPTS,
      reasoningEffort: FORECAST_AI_REASONING_EFFORT,
    });

    const forecast = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;

    expect(forecast.judgment).toEqual({ asOf: "2026-10-10", documents: [] });
    // Nine days of ¥30 so far.
    expect(forecast.spent).toBe("270");
    expect(forecast.categories).toEqual([
      // Twenty-one more days of ¥30: the lamp is not drawn as an everyday day.
      expect.objectContaining({
        name: "餐饮",
        spent: "270",
        forecast: { p10: "900.00", p50: "900.00", p90: "900.00" },
      }),
      // The books on the 20th; December's tuition is after the period.
      expect.objectContaining({
        name: "教育",
        spent: "0",
        forecast: { p10: "300.00", p50: "300.00", p90: "300.00" },
      }),
    ]);
    expect(forecast.total.p50).toBe("1200.00");

    // A second night has nothing new to judge.
    const calls = transport.complete.mock.calls.length;
    await runDailyMaintenance({ now: new Date() });
    expect(transport.complete.mock.calls.length).toBe(calls);
  });

  it("judges once a week", async () => {
    await runDailyMaintenance({ now: new Date() });
    const calls = transport.complete.mock.calls.length;

    for (const day of ["2026-10-11", "2026-10-16"]) {
      vi.setSystemTime(new Date(`${day}T04:00:00Z`));
      await runDailyMaintenance({ now: new Date() });
      expect(transport.complete.mock.calls.length).toBe(calls);
    }

    vi.setSystemTime(new Date("2026-10-17T04:00:00Z"));
    await runDailyMaintenance({ now: new Date() });
    expect(transport.complete.mock.calls.length).toBe(calls + 1);
    expect(digestOf(transport.complete.mock.calls.at(-1)![0])).toMatch(/^Today: 2026-10-17\./);
  });

  it("leaves the week's new entries to the next judgment, and does not count a charge twice", async () => {
    await runDailyMaintenance({ now: new Date() });
    const calls = transport.complete.mock.calls.length;
    // The books, bought six days early.
    await record("2026-10-14", "280", "education", "教材");

    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"));
    const later = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;
    expect(later.judgment!.asOf).toBe("2026-10-10");
    expect(later.categories.find((category) => category.name === "教育")).toMatchObject({
      spent: "280",
      forecast: { p50: "280.00" },
    });
    await settleJudgments();
    expect(transport.complete.mock.calls.length).toBe(calls);

    // A week on, the first read judges again in the background, the books included.
    vi.setSystemTime(new Date("2026-10-17T04:00:00Z"));
    await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");
    await vi.waitFor(() => expect(transport.complete.mock.calls.length).toBe(calls + 1));
    expect(digestOf(transport.complete.mock.calls.at(-1)![0])).toContain("教材");
  });

  it("judges again once the analyst's prompt has changed", async () => {
    await runDailyMaintenance({ now: new Date() });
    const calls = transport.complete.mock.calls.length;
    // As stored under an older prompt.
    await getTestDb()
      .update(forecastJudgments)
      .set({ inputFingerprint: "v2:0123456789abcdef" })
      .where(eq(forecastJudgments.asOf, "2026-10-10"));

    vi.setSystemTime(new Date("2026-10-10T04:31:00Z"));
    await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");
    await vi.waitFor(() => expect(transport.complete.mock.calls.length).toBe(calls + 1));
    expect(digestOf(transport.complete.mock.calls.at(-1)![0])).toMatch(/^Today: 2026-10-10\./);
  });

  it("falls back to the statistical model alone when the AI cannot be reached", async () => {
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new AppError("provider down", "ai_provider_unavailable", 503);
      })
    );
    const warn = vi.spyOn(logger, "warn");

    const outcomes = await runDailyMaintenance({ now: new Date() });
    expect(outcomes.forecast_judgments).toBe("failed");
    // The log says why, by a code that survives the production build.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ step: "forecast_judgments", errorCode: "ai_provider_unavailable" }),
      "Daily maintenance step failed"
    );

    const forecast = (await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai"))!;
    expect(forecast.judgment).toBeNull();
    expect(forecast.categories.map((category) => category.name)).toEqual(["餐饮"]);
    // The lamp is drawn as a food day now and then.
    expect(Number(forecast.categories[0]!.forecast.p90)).toBeGreaterThan(900);
  });

  it("does not judge again when a read is judging as the night begins", async () => {
    // The read's judgment is held at the provider until the night has started.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    setAiTransportForTests(
      fakeAiTransport(async (request) => {
        await held;
        return analyst(request);
      })
    );
    await getPeriodForecast({ period: THIS_MONTH }, "Asia/Shanghai");

    const night = judgeForecasts();
    setTimeout(() => release(), 250);
    await night;

    const rows = await getTestDb().select().from(forecastJudgments);
    expect(rows).toHaveLength(1);
  });

  it("keeps a judgment readable by the release before, which still needs phases and levels", async () => {
    await runDailyMaintenance({ now: new Date() });

    const [row] = await getTestDb().select().from(forecastJudgments);
    expect(row!.judgment).toMatchObject({ phases: [], categories: [] });
  });
});
