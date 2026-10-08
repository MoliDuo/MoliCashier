import { describe, expect, it } from "vitest";
import { boundJudgment } from "@/modules/forecast/domain/judgment/bounds";
import type { Judgment } from "@/modules/forecast/domain/judgment/schema";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

function daily(from: string, count: number, categoryId: string, amount: string): HistoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: addCivilDays(from, index),
    categoryId,
    currency: "CNY",
    amount,
  }));
}

// ¥30 of food a day for 100 days, and a ¥4,000 tuition.
const rows: HistoryRow[] = [
  ...daily("2026-07-01", 100, "food", "30"),
  { date: "2026-09-08", categoryId: "edu", currency: "CNY", amount: "4000", documentId: "t" },
];

const judgment: Judgment = {
  phases: [{ from: "2026-07-01", label: "在家" }],
  documents: [],
  expected: [
    { label: "学费", key: "edu", date: "2027-02-20", amount: 4500, cadence: "semester", seen: 1 },
    { label: "学费", key: "edu", date: "2027-03-20", amount: 90000, cadence: "semester", seen: 0 },
    { label: "新车", key: "car", date: "2027-01-01", amount: 90000, cadence: "irregular", seen: 0 },
  ],
  categories: [
    // A month's food given as a day's.
    { key: "food", low: 25, mid: 900, high: 1200, trend: "steady" },
    { key: "fun", low: 1, mid: 2, high: 3, trend: "steady" },
  ],
};

describe("boundJudgment", () => {
  it("holds everyday levels and expected purchases to what the history has seen", () => {
    const bounded = boundJudgment(judgment, rows, "2026-10-09", 1.5);

    expect(bounded.categories).toEqual([
      { key: "food", low: 25, mid: 45, high: 45, trend: "steady" },
      // Nothing seen to hold it to.
      { key: "fun", low: 1, mid: 2, high: 3, trend: "steady" },
    ]);
    expect(bounded.expected.map((item) => item.amount)).toEqual([4500, 6000, 90000]);
    expect(bounded.phases).toBe(judgment.phases);
  });

  it("reads only the days before the day judged", () => {
    const bounded = boundJudgment(judgment, rows, "2026-09-08", 1.5);

    // The tuition came on the day judged, so nothing in education had been seen yet.
    expect(bounded.expected.map((item) => item.amount)).toEqual([4500, 90000, 90000]);
  });
});
