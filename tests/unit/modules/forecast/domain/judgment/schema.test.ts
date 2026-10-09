import { describe, expect, it } from "vitest";
import { resolveJudgment, storedJudgmentSchema } from "@/modules/forecast/domain/judgment/schema";

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
const window = { asOf: "2026-10-04", expectedDays: 90 };

describe("resolveJudgment", () => {
  it("maps the references back to ids and keeps what holds up", () => {
    const judgment = resolveJudgment(
      {
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
      },
      refs,
      window
    );

    expect(judgment).toEqual({
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
    });
  });

  it("leaves out unknown references, dates out of range and amounts that make no sense", () => {
    const judgment = resolveJudgment(
      {
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
      },
      refs,
      window
    );

    expect(judgment).toEqual({ documents: [], expected: [] });
  });

  it("calls a recurring purchase with no cadence irregular", () => {
    const judgment = resolveJudgment(
      { documents: [{ ref: "d1", kind: "recurring" }], expected: [] },
      refs,
      window
    );

    expect(judgment.documents).toEqual([
      { documentId: "doc-rent", kind: "recurring", cadence: "irregular" },
    ]);
  });
});

describe("storedJudgmentSchema", () => {
  it("reads a judgment made when the analyst still judged phases and everyday levels", () => {
    const parsed = storedJudgmentSchema.parse({
      phases: [{ from: "2026-09-01", label: "读博" }],
      documents: [{ documentId: "doc-rent", kind: "recurring", cadence: "monthly" }],
      expected: [],
      categories: [{ key: "food", low: 1, mid: 2, high: 3, trend: "steady" }],
    });

    expect(parsed).toEqual({
      documents: [{ documentId: "doc-rent", kind: "recurring", cadence: "monthly" }],
      expected: [],
    });
  });
});
