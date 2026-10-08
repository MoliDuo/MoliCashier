import { describe, expect, it } from "vitest";
import { deriveStatsInsights } from "@/modules/stats/lib/derived-insights";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";

type Day = { date: string; total: string };

/** A running September, read through the 10th. */
function september(days: Day[], overrides: Partial<EnhancedStatsDto> = {}) {
  const base = buildEnhancedStatsFixture();
  return buildEnhancedStatsFixture({
    range: { from: "2026-09-01", to: "2026-09-10" },
    periodEnd: "2026-09-30",
    chart: days,
    summary: {
      ...base.summary,
      total: days.reduce((sum, day) => sum + Number(day.total), 0).toString(),
    },
    ...overrides,
  });
}

function category(overrides: Partial<EnhancedStatsDto["categories"][number]> = {}) {
  return {
    id: "food",
    name: "Food",
    icon: null,
    totalConverted: "100",
    currency: "CNY",
    percent: 100,
    count: 1,
    trend: { percent: 0, amount: "0" },
    ...overrides,
  };
}

/** Ten days of ¥30, one of them also paying ¥3,000 of rent. */
const tenDaysWithRent = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  total: index === 4 ? "3030" : "30",
}));

describe("deriveStatsInsights", () => {
  it("has nothing to say about a window with nothing recorded", () => {
    const insights = deriveStatsInsights(september([]));

    expect(insights).toMatchObject({
      entryCount: 0,
      typicalDaily: "0",
      busiestDay: null,
      topMover: null,
    });
  });

  it("counts entries through the categories", () => {
    const stats = september([{ date: "2026-09-01", total: "120" }], {
      categories: [category({ count: 3 }), category({ id: "fun", count: 2 })],
    });

    expect(deriveStatsInsights(stats).entryCount).toBe(5);
  });

  it("takes a typical day as the middle one, so one rent payment does not move it", () => {
    // The average of these ten days is ¥330; the day as it usually goes is ¥30.
    expect(deriveStatsInsights(september(tenDaysWithRent)).typicalDaily).toBe("30");
  });

  it("counts a day with nothing recorded as a day that cost nothing", () => {
    // Four of the ten days had spending; the middle of the ten is still zero.
    const insights = deriveStatsInsights(
      september([
        { date: "2026-09-01", total: "10" },
        { date: "2026-09-02", total: "20" },
        { date: "2026-09-03", total: "30" },
        { date: "2026-09-04", total: "40" },
      ])
    );

    expect(insights.typicalDaily).toBe("0");
  });

  it("averages the two middle days of an even count", () => {
    const insights = deriveStatsInsights(
      september(
        [
          { date: "2026-09-01", total: "10" },
          { date: "2026-09-02", total: "30" },
        ],
        { range: { from: "2026-09-01", to: "2026-09-02" } }
      )
    );

    expect(insights.typicalDaily).toBe("20");
  });

  it("forecasts a running period as what is spent plus a typical day for each day left", () => {
    // ¥3,300 so far, and twenty days to go at ¥30.
    expect(deriveStatsInsights(september(tenDaysWithRent)).forecast).toBe("3900");
  });

  it("does not forecast a period that is over", () => {
    const base = buildEnhancedStatsFixture();
    const stats = september(tenDaysWithRent, {
      range: { from: "2026-09-01", to: "2026-09-30" },
      summary: {
        ...base.summary,
        comparison: { ...base.summary.comparison, mode: "full_period" },
      },
    });

    expect(deriveStatsInsights(stats).forecast).toBeNull();
  });

  it("waits a few days before forecasting", () => {
    const stats = september([{ date: "2026-09-01", total: "80" }], {
      range: { from: "2026-09-01", to: "2026-09-02" },
    });

    expect(deriveStatsInsights(stats).forecast).toBeNull();
  });

  it("keeps a biggest day for a period that nets out negative", () => {
    const insights = deriveStatsInsights(
      september([
        { date: "2026-09-07", total: "-40" },
        { date: "2026-09-08", total: "-10" },
      ])
    );

    expect(insights.busiestDay).toEqual({ date: "2026-09-08", total: "-10" });
  });

  it("names the category that moved by the most money, not by the most percent", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [
        category({ id: "rent", name: "Rent", trend: { percent: 10, amount: "300" } }),
        category({ id: "gum", name: "Gum", trend: { percent: 100, amount: "3" } }),
      ],
    });

    expect(deriveStatsInsights(stats).topMover).toEqual({
      id: "rent",
      name: "Rent",
      amountDelta: "300",
      direction: "up",
    });
  });

  it("stays quiet when the biggest move is small against the period", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [category({ id: "gum", name: "Gum", trend: { percent: 100, amount: "3" } })],
    });

    expect(deriveStatsInsights(stats).topMover).toBeNull();
  });

  it("stays quiet when there is no previous period to compare against", () => {
    // Every category reads as +100% growth from nothing, which says nothing.
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: {
        ...base.summary,
        total: "1000",
        comparison: { ...base.summary.comparison, previousTotal: "0" },
      },
      categories: [category({ id: "rent", name: "Rent", trend: { percent: 100, amount: "900" } })],
    });

    expect(deriveStatsInsights(stats).topMover).toBeNull();
  });

  it("counts a category that went to nothing as the biggest move", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [category({ id: "food", name: "Food", trend: { percent: 10, amount: "90" } })],
      previousOnlyCategories: [{ id: "rent", name: "Rent", icon: null, previousTotal: "3000" }],
    });

    expect(deriveStatsInsights(stats).topMover).toEqual({
      id: "rent",
      name: "Rent",
      amountDelta: "3000",
      direction: "down",
    });
  });

  it("reads a drop as a drop", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: { ...base.summary, total: "1000" },
      categories: [category({ id: "rent", name: "Rent", trend: { percent: -30, amount: "-300" } })],
    });

    expect(deriveStatsInsights(stats).topMover).toMatchObject({
      amountDelta: "300",
      direction: "down",
    });
  });
});
