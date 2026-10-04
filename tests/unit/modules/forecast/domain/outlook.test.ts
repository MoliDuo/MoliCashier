import { describe, expect, it } from "vitest";
import { dayWeights, prepareHistory } from "@/modules/forecast/domain/history";
import { trainNetwork } from "@/modules/forecast/domain/nn/network";
import { simulateOutlook } from "@/modules/forecast/domain/outlook";
import { seededRandom } from "@/modules/forecast/domain/random";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  return step.value;
}

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
});

describe("simulateOutlook", () => {
  it("adds the bills on their days, for certain, to everyday spending", () => {
    const history = prepareHistory(ROWS, "2026-08-30", 7)!;

    const simulation = simulateOutlook(history, {
      weights: dayWeights(history, 30, 0.2),
      network: null,
      networkShare: 0,
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

  it("lets the network play its share of the paths", () => {
    const history = prepareHistory(ROWS, "2026-08-30", 7)!;
    const weights = dayWeights(history, 30, 0.2);
    const network = finish(
      trainNetwork({
        series: history.series,
        signals: history.signals,
        change: null,
        weights,
        random: seededRandom(2),
        options: {
          hidden: [6],
          maxEpochs: 10,
          patience: 3,
          batchSize: 32,
          learningRate: 0.02,
          l2: 1e-4,
          validationDays: 14,
        },
      })
    )!;

    const simulation = simulateOutlook(history, {
      weights,
      network,
      networkShare: 0.25,
      end: "2026-09-10",
      paths: 40,
      random: seededRandom(1),
    });

    const lunch = simulation.byCategory.get("lunch")!;
    expect(lunch).toHaveLength(40);
    // The statistical paths come first: every lunch exactly 20.
    expect(Array.from(lunch.slice(0, 30))).toEqual(Array(30).fill(220));
    expect(Array.from(simulation.byCategory.get("housing")!)).toEqual(Array(40).fill(3000));
  });
});
