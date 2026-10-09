import { describe, expect, it } from "vitest";
import { dayWeights, prepareHistory } from "@/modules/forecast/domain/history";
import { simulateOutlook } from "@/modules/forecast/domain/outlook";
import { seededRandom } from "@/modules/forecast/domain/random";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

/** Ninety days of lunch at 20, and rent of 3000 on the 5th of every month. */
const ROWS: HistoryRow[] = [
  ...Array.from({ length: 90 }, (_, day) => ({
    date: addCivilDays("2026-06-01", day),
    categoryId: "lunch",
    currency: "CNY",
    amount: "20",
    documentId: `lunch-${day}`,
    label: "Lunch",
  })),
  ...["2026-06-05", "2026-07-05", "2026-08-05"].map((date) => ({
    date,
    categoryId: "housing",
    currency: "CNY",
    amount: "3000",
    documentId: `rent-${date}`,
    label: "房租",
  })),
];

describe("prepareHistory", () => {
  it("takes the recurring bills out of the everyday days, and says nothing too early", () => {
    const history = prepareHistory(ROWS, "2026-08-30", 7)!;

    expect(history.bills.map((bill) => bill.label)).toEqual(["房租"]);
    expect(history.series.byCategory.get("housing")).toBeUndefined();
    expect(history.series.length).toBe(90);
    expect(prepareHistory(ROWS, "2026-06-05", 7)).toBeNull();
  });

  it("leaves the documents judged not everyday out of the everyday days, but still finds the bills", () => {
    const lunch = (day: number) => `lunch-${day}`;
    const judged = new Set([lunch(10), lunch(11), "rent-2026-07-05"]);
    const history = prepareHistory(ROWS, "2026-08-30", 7, judged)!;

    const days = history.series.byCategory.get("lunch")!;
    expect(days[10]).toBe(0);
    expect(days[11]).toBe(0);
    expect(days[12]).toBe(20);
    expect(history.bills.map((bill) => bill.label)).toEqual(["房租"]);
  });
});

describe("simulateOutlook", () => {
  it("adds the bills on their days, for certain, to everyday spending", () => {
    const history = prepareHistory(ROWS, "2026-08-30", 7)!;

    const simulation = simulateOutlook(history, {
      weights: dayWeights(history, 30, 0.2),
      end: "2026-09-10",
      paths: 20,
      random: seededRandom(1),
    });

    // Eleven days of lunch, and the rent on the 5th of September.
    expect(Array.from(simulation.byCategory.get("housing")!)).toEqual(Array(20).fill(3000));
    expect(simulation.running.at(-1)![0]).toBe(11 * 20 + 3000);
    // Day 6 from the 30th of August is the 5th of September.
    expect(simulation.running[4]![0]! - simulation.running[3]![0]!).toBe(20);
    expect(simulation.running[5]![0]! - simulation.running[4]![0]!).toBe(3020);
  });
});
