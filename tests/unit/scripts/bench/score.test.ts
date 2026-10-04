import { describe, expect, it } from "vitest";
import { scoreParse, type ParsedOutput } from "../../../../scripts/bench/tasks/parse/score";
import type { ParseExpect } from "../../../../scripts/bench/lib/schema";

const lunch: ParseExpect = {
  outcome: "success",
  entries: [
    { itemName: "Lunch set", amount: "45.00", currency: "CNY", category: "Food" },
    { itemName: "Discount", amount: "-5.00", currency: "CNY", category: "Food" },
  ],
};

const output = (
  entries: ParsedOutput["entries"],
  outcome: ParsedOutput["outcome"] = "success"
) => ({
  outcome,
  entries,
});

describe("parse scoring", () => {
  it("passes when the totals per currency and category match", () => {
    const score = scoreParse(
      lunch,
      output([
        { amount: "45.00", currency: "CNY", category: "Food" },
        { amount: "-5.00", currency: "CNY", category: "Food" },
      ])
    );
    expect(score.pass).toBe(true);
    expect(score.metrics).toMatchObject({
      outcome: 1,
      categoryTotals: 1,
      entryRecall: 1,
      entryPrecision: 1,
    });
  });

  it("accepts a different split of the same total but reports it in precision and recall", () => {
    const score = scoreParse(
      lunch,
      output([{ amount: "40.00", currency: "CNY", category: "Food" }])
    );
    expect(score.pass).toBe(true);
    expect(score.metrics.entryPrecision).toBe(0);
    expect(score.metrics.entryRecall).toBe(0);
  });

  it("compares amounts at the currency's own precision", () => {
    const expected: ParseExpect = {
      outcome: "success",
      entries: [{ itemName: "Visa fee", amount: "1713.000", currency: "MYR", category: null }],
    };
    expect(
      scoreParse(expected, output([{ amount: "1713.00", currency: "MYR", category: null }])).pass
    ).toBe(true);
  });

  it("fails on a wrong category even when the currency total is right", () => {
    const score = scoreParse(
      lunch,
      output([{ amount: "40.00", currency: "CNY", category: "Transport" }])
    );
    expect(score.pass).toBe(false);
    expect(score.metrics).toMatchObject({ currencyTotals: 1, categoryTotals: 0 });
  });

  it("fails on a wrong currency", () => {
    const score = scoreParse(
      lunch,
      output([{ amount: "40.00", currency: "USD", category: "Food" }])
    );
    expect(score.pass).toBe(false);
    expect(score.metrics.currencyTotals).toBe(0);
  });

  it("ignores buckets that cancel to zero", () => {
    const score = scoreParse(
      lunch,
      output([
        { amount: "40.00", currency: "CNY", category: "Food" },
        { amount: "9.99", currency: "CNY", category: "Transport" },
        { amount: "-9.99", currency: "CNY", category: "Transport" },
      ])
    );
    expect(score.pass).toBe(true);
  });

  it("fails an outcome mismatch in either direction", () => {
    const invalid: ParseExpect = { outcome: "invalid", entries: [] };
    expect(scoreParse(invalid, output([], "invalid")).pass).toBe(true);
    expect(
      scoreParse(invalid, output([{ amount: "1.00", currency: "CNY", category: null }])).pass
    ).toBe(false);
    const missed = scoreParse(lunch, output([], "invalid"));
    expect(missed.pass).toBe(false);
    expect(missed.metrics.outcome).toBe(0);
  });
});
