import { describe, expect, it } from "vitest";
import { applyJudgment, judgedSpendingAhead } from "@/modules/forecast/domain/judgment/apply";
import type { Judgment } from "@/modules/forecast/domain/judgment/schema";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

function daily(from: string, count: number, categoryId: string, amount: string): HistoryRow[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addCivilDays(from, index);
    return { date, categoryId, currency: "CNY", amount, documentId: `${categoryId}-${date}` };
  });
}

// Food at ¥20 a day through August, ¥30 from September; tuition on September 8th; books on October 2nd.
const rows: HistoryRow[] = [
  ...daily("2026-08-01", 31, "food", "20"),
  ...daily("2026-09-01", 40, "food", "30"),
  { date: "2026-09-08", categoryId: "edu", currency: "CNY", amount: "4000", documentId: "tuition" },
  { date: "2026-10-02", categoryId: "edu", currency: "CNY", amount: "500", documentId: "books" },
];

const judgment: Judgment = {
  phases: [
    { from: "2026-08-01", label: "两人同住" },
    { from: "2026-09-01", label: "读博" },
  ],
  documents: [
    { documentId: "tuition", kind: "recurring", cadence: "semester" },
    { documentId: "books", kind: "one_off", cadence: null },
  ],
  expected: [
    { label: "房租", key: "home", date: "2026-10-15", amount: 1200, cadence: "monthly", seen: 2 },
    { label: "学费", key: "edu", date: "2026-12-20", amount: 4000, cadence: "semester", seen: 1 },
  ],
  categories: [
    { key: "food", low: 25, mid: 30, high: 40, trend: "rising" },
    { key: "transport", low: 0, mid: 5, high: 10, trend: "steady" },
  ],
};

describe("applyJudgment", () => {
  it("adds each category's judged day for the days left, and what is expected before the end", () => {
    const forecast = applyJudgment({
      judgment,
      rows,
      today: "2026-10-10",
      period: { from: "2026-10-01", end: "2026-10-31" },
    })!;

    // Ten days of food (300) and the books (500) so far.
    expect(forecast.spent).toBe("800");
    const byKey = new Map(forecast.categories.map((category) => [category.key, category]));
    // Twenty-one days left.
    expect(byKey.get("food")!.forecast).toEqual({ p10: 825, p50: 930, p90: 1140 });
    expect(byKey.get("home")!.forecast).toEqual({ p10: 1200, p50: 1200, p90: 1200 });
    expect(byKey.get("transport")!.forecast).toEqual({ p10: 0, p50: 105, p90: 210 });
    // Next semester's tuition is after the period: listed, not counted.
    expect(byKey.get("edu")!.forecast).toEqual({ p10: 500, p50: 500, p90: 500 });
    expect(forecast.categories.map((category) => category.key)).toEqual([
      "home",
      "food",
      "edu",
      "transport",
    ]);

    // The total is the categories' middle; its spread narrower than every category at its extreme.
    expect(forecast.total.p50).toBe(800 + 1200 + 21 * 35);
    expect(forecast.total.p90).toBeCloseTo(800 + 1200 + 21 * 35 + Math.hypot(210, 105));
    expect(forecast.total.p10).toBeCloseTo(800 + 1200 + 21 * 35 - Math.hypot(105, 105));
    expect(forecast.running).toHaveLength(21);
    expect(forecast.running[0]!.p50).toBe(835);
    // The rent lands on the 15th, the fifth day ahead.
    expect(forecast.running[4]!.p50 - forecast.running[3]!.p50).toBe(1235);

    expect(forecast.documents).toEqual([{ documentId: "books", kind: "one_off", cadence: null }]);
  });

  it("works out each phase's everyday day and how the last two weeks compare with it", () => {
    const forecast = applyJudgment({
      judgment,
      rows,
      today: "2026-10-10",
      period: { from: "2026-10-01", end: "2026-10-31" },
    })!;

    // Tuition is not an everyday purchase, so it does not lift September's day.
    expect(forecast.phases).toEqual([
      { from: "2026-08-01", to: "2026-08-31", label: "两人同住", daily: 20 },
      { from: "2026-09-01", to: "2026-10-09", label: "读博", daily: 30 },
    ]);
    // The analyst said rising, but the last two weeks cost what the phase's usual day does.
    const food = forecast.categories.find((category) => category.key === "food")!;
    expect(food.trend).toEqual({ direction: "steady", change: 0 });
    // Nothing everyday of its own, no trend.
    expect(forecast.categories.find((category) => category.key === "edu")!.trend).toBeNull();
  });

  it("reads the arrow from the same figure as the percentage, whatever the analyst said", () => {
    // ¥30 a day through September 25th, then ¥15 a day for the last two weeks.
    const cheaper = [
      ...daily("2026-09-01", 25, "food", "30"),
      ...daily("2026-09-26", 14, "food", "15"),
    ];
    const forecast = applyJudgment({
      judgment: { ...judgment, phases: [{ from: "2026-09-01", label: "读博" }] },
      rows: cheaper,
      today: "2026-10-10",
      period: { from: "2026-10-01", end: "2026-10-31" },
    })!;

    const trend = forecast.categories.find((category) => category.key === "food")!.trend!;
    expect(trend.direction).toBe("falling");
    // ¥15 against the phase's ¥960 over 39 days.
    expect(trend.change).toBeCloseTo(15 / (960 / 39) - 1);
  });

  it("has no trend while the current phase is too short to have a usual day", () => {
    const forecast = applyJudgment({
      judgment: { ...judgment, phases: [{ from: "2026-09-25", label: "读博" }] },
      rows,
      today: "2026-10-10",
      period: { from: "2026-10-01", end: "2026-10-31" },
    })!;

    expect(forecast.categories.find((category) => category.key === "food")!.trend).toBeNull();
  });

  it("says nothing for a period with no days left", () => {
    expect(
      applyJudgment({
        judgment,
        rows,
        today: "2026-10-31",
        period: { from: "2026-10-01", end: "2026-10-31" },
      })
    ).toBeNull();
  });
});

describe("judgedSpendingAhead", () => {
  it("counts the judged days and what was expected within them", () => {
    // Fourteen days of ¥35 and the rent.
    expect(judgedSpendingAhead(judgment, "2026-10-10", 14)).toBe(14 * 35 + 1200);
    expect(judgedSpendingAhead(judgment, "2026-10-15", 14)).toBe(14 * 35);
  });
});
