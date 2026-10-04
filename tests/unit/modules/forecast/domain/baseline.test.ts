import { describe, expect, it } from "vitest";
import { fitBaselineModel } from "@/modules/forecast/domain/baseline";
import { recencyWeights } from "@/modules/forecast/domain/weights";

/** Four weeks starting on a Monday (weekday 1), with spending only on Saturdays. */
function saturdays(amount: number): Float64Array {
  const values = new Float64Array(28);
  for (let day = 5; day < 28; day += 7) values[day] = amount;
  return values;
}

describe("fitBaselineModel", () => {
  it("learns which weekdays spend, pulled towards the overall rate", () => {
    const model = fitBaselineModel({
      values: saturdays(80),
      weights: recencyWeights(28, null),
      length: 28,
      firstWeekday: 1,
      // Today is the Monday after the four weeks; day 5 from it is a Saturday.
      todayWeekday: 1,
    })!;

    const saturday = model.chance(5);
    const sunday = model.chance(6);
    // Four Saturdays out of four, blended with a week of the overall one day in seven.
    expect(saturday).toBeCloseTo((4 + 7 / 7) / (4 + 7));
    expect(sunday).toBeCloseTo(7 / 7 / (4 + 7));
    expect(model.chance(12)).toBe(saturday);
    expect(model.amount(5, 0)).toBe(80);
    expect(model.amount(5, 0.999)).toBe(80);
  });

  it("leans a rate resting on few days towards the category's long-run rate", () => {
    // Two gifts in the fortnight since life changed, where a gift used to come once a month.
    const values = new Float64Array(14);
    values[3] = 200;
    values[10] = 150;
    const input = {
      values,
      weights: recencyWeights(14, null),
      length: 14,
      firstWeekday: 0,
      todayWeekday: 0,
    };

    const alone = fitBaselineModel(input)!;
    const leaning = fitBaselineModel({ ...input, longRunChance: 1 / 30 })!;

    // Overall: 2 in 14 alone; (2 + 14 / 30) / (14 + 14) leaning on the long run.
    const average = (model: typeof alone) =>
      [1, 2, 3, 4, 5, 6, 7].reduce((sum, day) => sum + model.chance(day), 0) / 7;
    expect(average(alone)).toBeCloseTo(2 / 14);
    expect(average(leaning)).toBeCloseTo((2 + 14 / 30) / 28, 1);
  });

  it("draws amounts in proportion to how recent their days are", () => {
    const values = new Float64Array([10, 0, 0, 90]);
    const model = fitBaselineModel({
      values,
      // The 90 day weighs three times the 10 day.
      weights: new Float64Array([1, 1, 1, 3]),
      length: 4,
      firstWeekday: 0,
      todayWeekday: 4,
    })!;

    expect(model.amount(1, 0.2)).toBe(10);
    expect(model.amount(1, 0.3)).toBe(90);
    expect(model.amount(1, 0.99)).toBe(90);
  });

  it("has nothing to say about a category that never spent", () => {
    expect(
      fitBaselineModel({
        values: new Float64Array(7),
        weights: recencyWeights(7, 30),
        length: 7,
        firstWeekday: 0,
        todayWeekday: 0,
      })
    ).toBeNull();
  });
});
