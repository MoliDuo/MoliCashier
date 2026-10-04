import { describe, expect, it } from "vitest";
import { resolveJudgment } from "@/modules/forecast/domain/judgment/schema";

const refs = {
  documents: new Map([
    ["d1", "doc-rent"],
    ["d2", "doc-tuition"],
  ]),
  categories: new Map([
    ["c0", "__uncategorized__"],
    ["c1", "food"],
    ["c2", "home"],
  ]),
};
const window = { earliest: "2026-01-02", asOf: "2026-10-04", expectedDays: 90 };

describe("resolveJudgment", () => {
  it("maps the references back to ids and keeps what holds up", () => {
    const judgment = resolveJudgment(
      {
        phases: [
          { from: "2026-09-01", label: "读博" },
          { from: "2025-12-01", label: "在家过年的那段日子很长很长" },
        ],
        documents: [
          { ref: "d1", kind: "recurring", cadence: "monthly" },
          { ref: "d2", kind: "one_off", cadence: "semester" },
        ],
        expected: [
          {
            label: "房租",
            category: "c2",
            date: "2026-11-01",
            amount: 1200,
            cadence: "monthly",
            basis: ["d1", "d1", "d9"],
          },
        ],
        categories: [{ category: "c1", low: 60, mid: 40, high: 80, trend: "rising" }],
      },
      refs,
      window
    );

    expect(judgment).toEqual({
      // In order, the first moved to the first day recorded, the label cut to twelve.
      phases: [
        { from: "2026-01-02", label: "在家过年的那段日子很长很" },
        { from: "2026-09-01", label: "读博" },
      ],
      documents: [
        { documentId: "doc-rent", kind: "recurring", cadence: "monthly" },
        { documentId: "doc-tuition", kind: "one_off", cadence: null },
      ],
      // One past purchase it rests on: the unknown reference and the repeat are not counted.
      expected: [
        {
          label: "房租",
          key: "home",
          date: "2026-11-01",
          amount: 1200,
          cadence: "monthly",
          seen: 1,
        },
      ],
      // Low, middle and high put in order.
      categories: [{ key: "food", low: 40, mid: 60, high: 80, trend: "rising" }],
    });
  });

  it("leaves out unknown references, dates out of range and amounts that make no sense", () => {
    const judgment = resolveJudgment(
      {
        phases: [{ from: "2026-11-01", label: "未来" }, { label: "无日期" }],
        documents: [
          { ref: "d7", kind: "one_off" },
          { ref: "d1", kind: "sometimes" },
        ],
        expected: [
          { label: "过去", category: "c2", date: "2026-10-04", amount: 1, cadence: "monthly" },
          { label: "太远", category: "c2", date: "2027-03-01", amount: 1, cadence: "yearly" },
          { label: "负数", category: "c2", date: "2026-10-20", amount: -5, cadence: "monthly" },
          { label: "无分类", category: "c9", date: "2026-10-20", amount: 5, cadence: "monthly" },
          { label: "字符串", category: "c2", date: "2026-10-20", amount: "5", cadence: "monthly" },
        ],
        categories: [
          { category: "c9", low: 1, mid: 2, high: 3, trend: "steady" },
          { category: "c1", low: -1, mid: 2, high: 3, trend: "steady" },
        ],
      },
      refs,
      window
    );

    expect(judgment).toEqual({
      phases: [],
      documents: [],
      expected: [],
      categories: [{ key: "food", low: 0, mid: 2, high: 3, trend: "steady" }],
    });
  });

  it("calls a recurring purchase with no cadence irregular", () => {
    const judgment = resolveJudgment(
      { phases: [], documents: [{ ref: "d1", kind: "recurring" }], expected: [], categories: [] },
      refs,
      window
    );

    expect(judgment.documents).toEqual([
      { documentId: "doc-rent", kind: "recurring", cadence: "irregular" },
    ]);
  });
});
