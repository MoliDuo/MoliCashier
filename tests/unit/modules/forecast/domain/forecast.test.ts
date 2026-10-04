import { describe, expect, it } from "vitest";
import { forecastPeriod, type ForecastOptions } from "@/modules/forecast/domain/forecast";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

const OPTIONS: ForecastOptions = {
  halfLifeDays: 30,
  changeDiscount: 0.2,
  paths: 400,
  seed: 7,
  minHistoryDays: 7,
};

/** `amount` in `category` every `every` days from `from`, `count` times. */
function spending(
  from: string,
  count: number,
  categoryId: string | null,
  amount: string,
  every = 1
): HistoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: addCivilDays(from, index * every),
    categoryId,
    currency: "CNY",
    amount,
  }));
}

describe("forecastPeriod", () => {
  it("adds the rest of the month at the pace the days so far kept", () => {
    // Thirty yuan of food every day of September and October so far.
    const rows = spending("2026-09-01", 40, "food", "30");

    const forecast = forecastPeriod({
      rows,
      today: "2026-10-10",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: { from: "2026-09-01", to: "2026-09-30" },
      options: OPTIONS,
    })!;

    // Ten days spent (300), twenty-one to go at 30 a day.
    expect(forecast.spent).toBe("300");
    expect(forecast.total.p10).toBeCloseTo(930);
    expect(forecast.total.p90).toBeCloseTo(930);
    expect(forecast.running).toHaveLength(21);
    expect(forecast.running[0]!.p50).toBeCloseTo(330);
    expect(forecast.categories).toEqual([
      { key: "food", spent: "300", forecast: { p10: 930, p50: 930, p90: 930 } },
    ]);
    // September came to 900, and every outcome ends above it.
    expect(forecast.exceedPrevious).toEqual({ total: "900", probability: 1 });
  });

  it("follows the way life goes now rather than the average of all of it", () => {
    // Half a year at 100 a day, then a move: 20 a day for the last month.
    const rows = [
      ...spending("2026-03-01", 184, "daily", "100"),
      ...spending("2026-09-01", 33, "daily", "20"),
    ];

    const forecast = forecastPeriod({
      rows,
      today: "2026-10-03",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: null,
      options: OPTIONS,
    })!;

    // The move is found, and the half year before it counts for little:
    // every day counted the same, a day would cost about 88; faded by time
    // alone, about 58.
    expect(forecast.lifeChange).toEqual({ date: "2026-09-01", dailyBefore: 100, dailyAfter: 20 });
    const perDay = (forecast.total.p50 - Number(forecast.spent)) / 28;
    expect(perDay).toBeLessThan(40);
    expect(perDay).toBeGreaterThanOrEqual(20);
    expect(forecast.exceedPrevious).toBeNull();
  });

  it("lets the time before a change still count for something, as asked", () => {
    const rows = [
      ...spending("2026-03-01", 184, "daily", "100"),
      ...spending("2026-09-01", 33, "daily", "20"),
    ];
    const input = {
      rows,
      today: "2026-10-03",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: null,
    };

    const discounted = forecastPeriod({ ...input, options: OPTIONS })!;
    const undiscounted = forecastPeriod({ ...input, options: { ...OPTIONS, changeDiscount: 1 } })!;

    expect(undiscounted.lifeChange).not.toBeNull();
    expect(discounted.total.p50).toBeLessThan(undiscounted.total.p50);
  });

  it("finds no change in a ledger that has gone on the same way", () => {
    const rows = [
      ...spending("2026-06-01", 40, "coffee", "15", 3),
      ...spending("2026-06-02", 40, "coffee", "45", 3),
    ];

    const forecast = forecastPeriod({
      rows,
      today: "2026-10-01",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: null,
      options: OPTIONS,
    })!;

    expect(forecast.lifeChange).toBeNull();
  });

  it("spreads a category that spends some days and not others", () => {
    // Coffee on about one day in three, at 15 or 45.
    const rows = [
      ...spending("2026-08-01", 22, "coffee", "15", 3),
      ...spending("2026-08-02", 21, "coffee", "45", 3),
    ];

    const forecast = forecastPeriod({
      rows,
      today: "2026-10-01",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: null,
      options: OPTIONS,
    })!;
    const coffee = forecast.categories[0]!;

    expect(coffee.forecast.p10).toBeLessThan(coffee.forecast.p50);
    expect(coffee.forecast.p50).toBeLessThan(coffee.forecast.p90);
    for (let day = 1; day < forecast.running.length; day++) {
      expect(forecast.running[day]!.p50).toBeGreaterThanOrEqual(forecast.running[day - 1]!.p50);
    }
  });

  it("lists categories by where they are expected to end, keeping ones only spent so far", () => {
    const rows = [
      ...spending("2026-09-01", 30, "food", "30"),
      ...spending("2026-09-01", 30, "transport", "10"),
      ...spending("2026-10-01", 1, null, "500"),
    ];

    const forecast = forecastPeriod({
      rows,
      today: "2026-10-01",
      period: { from: "2026-10-01", end: "2026-10-07" },
      previous: null,
      options: OPTIONS,
    })!;

    // Today's 500 uncategorized is spent but not a day to learn from.
    expect(forecast.categories.map((category) => category.key)).toEqual([
      "__uncategorized__",
      "food",
      "transport",
    ]);
    expect(forecast.categories[0]!.forecast).toEqual({ p10: 500, p50: 500, p90: 500 });
  });

  it("gives the same figures for the same seed and different ones for another", () => {
    const rows = spending("2026-08-01", 30, "coffee", "15", 2);
    const input = {
      rows,
      today: "2026-10-01",
      period: { from: "2026-10-01", end: "2026-10-31" },
      previous: null,
    };

    const first = forecastPeriod({ ...input, options: OPTIONS });
    expect(forecastPeriod({ ...input, options: OPTIONS })).toEqual(first);
    expect(forecastPeriod({ ...input, options: { ...OPTIONS, seed: 8 } })).not.toEqual(first);
  });

  it("says nothing for a period with no days left or a ledger too new to learn from", () => {
    const rows = spending("2026-09-25", 7, "food", "30");
    const period = { from: "2026-10-01", end: "2026-10-31" };

    expect(
      forecastPeriod({ rows, today: "2026-10-31", period, previous: null, options: OPTIONS })
    ).toBeNull();
    expect(
      forecastPeriod({ rows, today: "2026-10-01", period, previous: null, options: OPTIONS })
    ).toBeNull();
    expect(
      forecastPeriod({ rows: [], today: "2026-10-10", period, previous: null, options: OPTIONS })
    ).toBeNull();
    // A week of history is enough.
    expect(
      forecastPeriod({ rows, today: "2026-10-02", period, previous: null, options: OPTIONS })
    ).not.toBeNull();
  });
});
