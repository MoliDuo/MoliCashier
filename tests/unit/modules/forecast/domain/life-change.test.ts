import { describe, expect, it } from "vitest";
import { dailySignals, detectLifeChange } from "@/modules/forecast/domain/life-change";
import { seededRandom } from "@/modules/forecast/domain/random";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays, civilDaysBetween } from "@/modules/ledger/domain/period";

const START = "2026-01-01";
/** A week's rhythm: a big shop on the first day, little the rest. */
const RHYTHM = [3, 0.6, 0.8, 0.5, 1.2, 0.4, 0.9];

/** Spending every day for `days` days from `from`, at `level` a day on average. */
function days(from: number, count: number, level: number, currency = "CNY"): HistoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    date: addCivilDays(START, from + index),
    categoryId: "daily",
    currency,
    amount: (level * RHYTHM[(from + index) % 7]!).toFixed(2),
  }));
}

describe("dailySignals", () => {
  it("adds up each day and the part spent in the currency used most lately", () => {
    const rows: HistoryRow[] = [
      { date: "2026-01-01", categoryId: null, currency: "CNY", amount: "30" },
      { date: "2026-01-02", categoryId: null, currency: "MYR", amount: "20" },
      { date: "2026-01-02", categoryId: null, currency: "MYR", amount: "-5" },
      { date: "2026-01-03", categoryId: null, currency: "MYR", amount: "40" },
      // Outside the days asked for.
      { date: "2026-01-04", categoryId: null, currency: "CNY", amount: "999" },
    ];

    const signals = dailySignals(rows, START, 3);

    expect(Array.from(signals.totals)).toEqual([30, 15, 40]);
    expect(Array.from(signals.positive)).toEqual([30, 20, 40]);
    expect(Array.from(signals.dominant)).toEqual([0, 20, 40]);
  });
});

describe("detectLifeChange", () => {
  it("finds the day spending settled at a new level", () => {
    const rows = [...days(0, 98, 100), ...days(98, 42, 30)];

    const change = detectLifeChange(dailySignals(rows, START, 140));

    expect(change).not.toBeNull();
    // The week's rhythm can blur the exact day by one.
    expect(Math.abs(change!.day - 98)).toBeLessThanOrEqual(1);
    expect(change!.dailyBefore).toBeCloseTo(100, -1);
    expect(change!.dailyAfter).toBeCloseTo(30, -1);
  });

  it("finds a move abroad by the currency even when the totals hold", () => {
    const rows = [...days(0, 84, 100, "CNY"), ...days(84, 35, 100, "MYR")];

    const change = detectLifeChange(dailySignals(rows, START, 119));

    expect(change?.day).toBe(84);
  });

  it("finds nothing in a history that goes on the same way", () => {
    const rows = days(0, 140, 100);

    expect(detectLifeChange(dailySignals(rows, START, 140))).toBeNull();
  });

  it("takes one costly week for an odd week, not a new way of living", () => {
    const rows = [...days(0, 70, 100), ...days(70, 7, 600), ...days(77, 49, 100)];

    expect(detectLifeChange(dailySignals(rows, START, 126))).toBeNull();
  });

  it("waits for a new level to hold more than one week", () => {
    const rows = [...days(0, 84, 100), ...days(84, 7, 20)];

    expect(detectLifeChange(dailySignals(rows, START, 91))).toBeNull();
  });

  it("says nothing with too few weeks to tell a change from noise", () => {
    const rows = [...days(0, 21, 100), ...days(21, 14, 20)];

    expect(detectLifeChange(dailySignals(rows, START, 35))).toBeNull();
  });

  it("picks out a move abroad from a year of noisy, shifting days, ten days after it", () => {
    // New Year, a stretch alone, summer at home, two at home, then abroad:
    // every day a noisy draw around its stretch's level, one in ten tripled.
    const stretches = [
      { from: "2026-01-01", level: 250, currency: "CNY" },
      { from: "2026-02-01", level: 120, currency: "CNY" },
      { from: "2026-06-01", level: 160, currency: "CNY" },
      { from: "2026-08-01", level: 200, currency: "CNY" },
      { from: "2026-09-01", level: 60, currency: "MYR" },
    ];
    for (const seed of [1, 2, 3]) {
      const random = seededRandom(seed);
      const length = civilDaysBetween(START, "2026-09-11");
      const rows = Array.from({ length }, (_, day): HistoryRow => {
        const date = addCivilDays(START, day);
        const stretch = stretches.findLast((candidate) => candidate.from <= date)!;
        const amount = stretch.level * (0.3 + random() * 1.4) * (random() < 0.1 ? 3 : 1);
        return { date, categoryId: null, currency: stretch.currency, amount: amount.toFixed(2) };
      });

      const change = detectLifeChange(dailySignals(rows, START, length));

      expect(change && addCivilDays(START, change.day)).toBe("2026-09-01");
    }
  });
});
