import { describe, expect, it } from "vitest";
import type { PeriodForecast } from "@/modules/forecast/domain/forecast";
import {
  expectedCharges,
  judgedDocumentsIn,
  withExpectedCharges,
} from "@/modules/forecast/domain/judgment/apply";
import type { JudgedExpected, Judgment } from "@/modules/forecast/domain/judgment/schema";
import type { HistoryRow } from "@/modules/forecast/domain/series";

const TODAY = "2026-10-10";
const END = "2026-10-13";

/** Food at ¥30 a day, three days left, and the statistical model's rent due on the 12th. */
const forecast: PeriodForecast = {
  spent: "300",
  total: { p10: 380, p50: 390, p90: 420 },
  running: [
    { p10: 320, p50: 330, p90: 340 },
    { p10: 350, p50: 360, p90: 380 },
    { p10: 380, p50: 390, p90: 420 },
  ],
  categories: [{ key: "food", spent: "300", forecast: { p10: 380, p50: 390, p90: 420 } }],
  lifeChange: null,
  upcoming: [
    { date: "2026-10-12", label: "房租", key: "home", amount: 1200, cadence: "monthly", streak: 3 },
  ],
  anomalies: [],
  largeFrom: null,
};

function charge(label: string, key: string, date: string, amount: number): JudgedExpected {
  return { label, key, date, amount, cadence: "irregular", seen: 1 };
}

describe("expectedCharges", () => {
  it("keeps what the forecast does not count already", () => {
    const judgment: Judgment = {
      documents: [],
      expected: [
        charge("学费", "edu", "2026-10-12", 4000),
        // The statistical model has the rent, a day apart.
        charge("房租", "home", "2026-10-13", 1200),
        // Bought two days early, after the judgment.
        charge("教材", "books", "2026-10-11", 500),
        // After the period, and already past.
        charge("年费", "fees", "2026-10-20", 100),
        charge("保险", "fees", "2026-10-09", 100),
      ],
    };
    const rows: HistoryRow[] = [
      { date: "2026-10-08", categoryId: "books", currency: "CNY", amount: "300", documentId: "b" },
      // Before the judgment: the analyst saw it and still expects the next one.
      { date: "2026-10-04", categoryId: "edu", currency: "CNY", amount: "4000", documentId: "t" },
    ];

    expect(
      expectedCharges({ judgment, asOf: "2026-10-05", rows, forecast, today: TODAY, end: END })
    ).toEqual([charge("学费", "edu", "2026-10-12", 4000)]);
  });

  it("does not take a small purchase for the charge", () => {
    const judgment: Judgment = {
      documents: [],
      expected: [charge("教材", "books", "2026-10-11", 500)],
    };
    const rows: HistoryRow[] = [
      { date: "2026-10-08", categoryId: "books", currency: "CNY", amount: "40", documentId: "pen" },
    ];

    expect(
      expectedCharges({ judgment, asOf: "2026-10-05", rows, forecast, today: TODAY, end: END })
    ).toHaveLength(1);
  });
});

describe("withExpectedCharges", () => {
  it("adds each charge to its category, to the running total from its day, and to the total", () => {
    const shown = withExpectedCharges(
      forecast,
      [charge("学费", "edu", "2026-10-12", 4000), charge("礼物", "food", "2026-10-11", 100)],
      TODAY
    );

    expect(shown.categories).toEqual([
      { key: "edu", spent: "0", forecast: { p10: 4000, p50: 4000, p90: 4000 } },
      { key: "food", spent: "300", forecast: { p10: 480, p50: 490, p90: 520 } },
    ]);
    expect(shown.running.map((day) => day.p50)).toEqual([430, 4460, 4490]);
    expect(shown.total).toEqual({ p10: 4480, p50: 4490, p90: 4520 });
    expect(shown.spent).toBe("300");
  });

  it("leaves the forecast as it is with nothing to add", () => {
    expect(withExpectedCharges(forecast, [], TODAY)).toBe(forecast);
  });
});

describe("judgedDocumentsIn", () => {
  it("finds the period's documents the AI judged not everyday", () => {
    const judgment: Judgment = {
      documents: [
        { documentId: "t", kind: "recurring", cadence: "semester" },
        { documentId: "old", kind: "one_off", cadence: null },
      ],
      expected: [],
    };
    const rows: HistoryRow[] = [
      { date: "2026-10-02", categoryId: "edu", currency: "CNY", amount: "4000", documentId: "t" },
      { date: "2026-10-02", categoryId: "edu", currency: "CNY", amount: "100", documentId: "t" },
      { date: "2026-09-02", categoryId: "fun", currency: "CNY", amount: "900", documentId: "old" },
      { date: "2026-10-03", categoryId: "food", currency: "CNY", amount: "30", documentId: "f" },
    ];

    expect(judgedDocumentsIn(judgment, rows, "2026-10-01", TODAY)).toEqual([
      { documentId: "t", kind: "recurring", cadence: "semester" },
    ]);
  });
});
