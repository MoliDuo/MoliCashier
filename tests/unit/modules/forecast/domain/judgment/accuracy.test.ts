import { describe, expect, it } from "vitest";
import {
  scorableJudgments,
  scoreJudgment,
  summarizeScores,
} from "@/modules/forecast/domain/judgment/accuracy";
import type { Judgment } from "@/modules/forecast/domain/judgment/schema";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

const STATISTICAL = {
  halfLifeDays: 30,
  changeDiscount: 0.2,
  paths: 200,
  seed: 7,
  minHistoryDays: 7,
};

function judging(mid: number): Judgment {
  return {
    phases: [],
    documents: [],
    expected: [],
    categories: [{ key: "food", low: mid, mid, high: mid, trend: "steady" }],
  };
}

// ¥30 of food every day from July through October 10th.
const rows: HistoryRow[] = Array.from({ length: 102 }, (_, index) => ({
  date: addCivilDays("2026-07-01", index),
  categoryId: "food",
  currency: "CNY",
  amount: "30",
}));

describe("scoreJudgment", () => {
  it("sets what a past judgment expected against what was spent, beside the statistical model", () => {
    const score = scoreJudgment({
      asOf: "2026-09-01",
      judgment: judging(40),
      rows,
      horizon: 14,
      statistical: STATISTICAL,
    });

    expect(score.actual).toBe(14 * 30);
    expect(score.judged).toBe(14 * 40);
    // The model has seen two months of ¥30 days.
    expect(score.statistical).toBeCloseTo(14 * 30);
  });

  it("only looks at what was recorded by the day judged", () => {
    const later = [
      ...rows,
      { date: "2026-09-03", categoryId: "food", currency: "CNY", amount: "1000" },
    ];
    const score = scoreJudgment({
      asOf: "2026-09-01",
      judgment: judging(30),
      rows: later,
      horizon: 14,
      statistical: STATISTICAL,
    });

    expect(score.actual).toBe(14 * 30 + 1000);
    expect(score.statistical).toBeCloseTo(14 * 30);
  });
});

describe("scorableJudgments", () => {
  it("keeps the judgments whose days ahead are over, newest first", () => {
    const judgments = ["2026-09-01", "2026-09-26", "2026-09-25", "2026-10-09"].map((asOf) => ({
      asOf,
    }));

    expect(scorableJudgments(judgments, "2026-10-10", 14).map((item) => item.asOf)).toEqual([
      "2026-09-25",
      "2026-09-01",
    ]);
  });
});

describe("summarizeScores", () => {
  it("gives each side's miss as a share of what was spent", () => {
    expect(
      summarizeScores(
        [
          { actual: 100, judged: 110, statistical: 70 },
          { actual: 300, judged: 290, statistical: 330 },
        ],
        14
      )
    ).toEqual({ origins: 2, horizonDays: 14, error: 20 / 400, statisticalError: 60 / 400 });
    expect(summarizeScores([], 14)).toBeNull();
    expect(summarizeScores([{ actual: 0, judged: 5, statistical: 0 }], 14)).toBeNull();
  });
});
