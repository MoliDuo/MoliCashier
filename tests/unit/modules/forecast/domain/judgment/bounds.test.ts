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
  documents: [{ documentId: "t", kind: "recurring", cadence: "semester" }],
  expected: [
    { label: "学费", key: "edu", date: "2027-02-20", amount: 4500, cadence: "semester", seen: 1 },
    { label: "学费", key: "edu", date: "2027-03-20", amount: 90000, cadence: "semester", seen: 0 },
    { label: "新车", key: "car", date: "2027-01-01", amount: 90000, cadence: "irregular", seen: 0 },
  ],
};

describe("boundJudgment", () => {
  it("holds expected purchases to what the history has seen", () => {
    const bounded = boundJudgment(judgment, rows, "2026-10-09", 1.5);

    // A car has nothing seen to hold it to.
    expect(bounded.expected.map((item) => item.amount)).toEqual([4500, 6000, 90000]);
    expect(bounded.documents).toBe(judgment.documents);
  });

  it("reads only the days before the day judged", () => {
    const bounded = boundJudgment(judgment, rows, "2026-09-08", 1.5);

    // The tuition came on the day judged, so nothing in education had been seen yet.
    expect(bounded.expected.map((item) => item.amount)).toEqual([4500, 90000, 90000]);
  });
});
