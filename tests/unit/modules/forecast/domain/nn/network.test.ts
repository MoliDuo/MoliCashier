import { describe, expect, it } from "vitest";
import { dailySignals } from "@/modules/forecast/domain/life-change";
import {
  logAmountAt,
  networkDayModels,
  readOutputs,
  sampleLoss,
  trainNetwork,
  type NetworkOptions,
} from "@/modules/forecast/domain/nn/network";
import { seededRandom } from "@/modules/forecast/domain/random";
import { buildDailySeries, weekdayOf, type HistoryRow } from "@/modules/forecast/domain/series";
import { recencyWeights } from "@/modules/forecast/domain/weights";
import { addCivilDays } from "@/modules/ledger/domain/period";

const OPTIONS: NetworkOptions = {
  hidden: [12, 6],
  maxEpochs: 60,
  patience: 8,
  batchSize: 32,
  learningRate: 0.02,
  l2: 1e-4,
  validationDays: 14,
};

/** Run a generator to its end, as a test has nothing else to do in between. */
function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  return step.value;
}

/** Twelve weeks: lunch every day around 20, and an outing every Saturday and Sunday around 50. */
function weekendHistory(): { rows: HistoryRow[]; start: string; end: string } {
  const random = seededRandom(9);
  const start = "2026-06-01";
  const rows: HistoryRow[] = [];
  for (let day = 0; day < 84; day++) {
    const date = addCivilDays(start, day);
    const jitter = () => 0.8 + random() * 0.4;
    rows.push({ date, categoryId: "lunch", currency: "CNY", amount: (20 * jitter()).toFixed(2) });
    if (weekdayOf(date) === 0 || weekdayOf(date) === 6) {
      rows.push({
        date,
        categoryId: "outing",
        currency: "CNY",
        amount: (50 * jitter()).toFixed(2),
      });
    }
  }
  return { rows, start, end: addCivilDays(start, 83) };
}

function trainingInput(seed: number) {
  const { rows, start, end } = weekendHistory();
  const series = buildDailySeries(rows, start, end);
  return {
    series,
    signals: dailySignals(rows, start, series.length),
    change: null,
    weights: recencyWeights(series.length, null),
    random: seededRandom(seed),
    options: OPTIONS,
  };
}

describe("sampleLoss", () => {
  it("has the gradient that nudging each output gives", () => {
    const output = Float64Array.of(0.4, 2.5, -0.3, 0.7);
    for (const spent of [true, false]) {
      const { gradient } = sampleLoss(output, spent, 3.1);
      for (let index = 0; index < output.length; index++) {
        const step = 1e-6;
        const up = Float64Array.from(output);
        up[index] = up[index]! + step;
        const down = Float64Array.from(output);
        down[index] = down[index]! - step;
        const numeric =
          (sampleLoss(up, spent, 3.1).loss - sampleLoss(down, spent, 3.1).loss) / (2 * step);
        expect(gradient[index]).toBeCloseTo(numeric, 5);
      }
    }
  });
});

describe("readOutputs and logAmountAt", () => {
  it("keeps the quantiles in order and reads amounts off a line through them", () => {
    const { chance, quantiles } = readOutputs(Float64Array.of(0, 1, -5, -5));
    expect(chance).toBeCloseTo(0.5);
    expect(quantiles[0]).toBeLessThanOrEqual(quantiles[1]);
    expect(quantiles[1]).toBeLessThanOrEqual(quantiles[2]);

    expect(logAmountAt([1, 2, 4], 0.1)).toBeCloseTo(1);
    expect(logAmountAt([1, 2, 4], 0.5)).toBeCloseTo(2);
    expect(logAmountAt([1, 2, 4], 0.9)).toBeCloseTo(4);
    expect(logAmountAt([1, 2, 4], 0.7)).toBeCloseTo(3);
    expect(logAmountAt([1, 2, 4], 1)).toBeCloseTo(4.5);
  });
});

describe("trainNetwork", () => {
  it("learns which days a category spends on and roughly what it costs", () => {
    const input = trainingInput(1);
    const model = finish(trainNetwork(input))!;
    const models = networkDayModels(model, { ...input, days: 7 });

    // The series ends on Sunday 2026-08-23, so day 6 is the next Saturday and day 1 a Monday.
    expect(weekdayOf(addCivilDays(input.series.start, input.series.length - 1 + 6))).toBe(6);
    const outing = models.get("outing")!;
    expect(outing.chance(6)).toBeGreaterThan(0.6);
    expect(outing.chance(1)).toBeLessThan(0.3);
    const typicalOuting = outing.amount(6, 0.5);
    expect(typicalOuting).toBeGreaterThan(35);
    expect(typicalOuting).toBeLessThan(70);
    expect(models.get("lunch")!.chance(1)).toBeGreaterThan(0.8);
  });

  it("trains the same network from the same seed", () => {
    const first = finish(trainNetwork(trainingInput(4)))!;
    const second = finish(trainNetwork(trainingInput(4)))!;
    expect(second.mlp).toEqual(first.mlp);
  });

  it("has nothing to learn from a few days", () => {
    const rows: HistoryRow[] = [
      { date: "2026-06-01", categoryId: "lunch", currency: "CNY", amount: "20" },
      { date: "2026-06-05", categoryId: "lunch", currency: "CNY", amount: "20" },
    ];
    const series = buildDailySeries(rows, "2026-06-01", "2026-06-10");
    expect(
      finish(
        trainNetwork({
          series,
          signals: dailySignals(rows, "2026-06-01", series.length),
          change: null,
          weights: recencyWeights(series.length, null),
          random: seededRandom(1),
          options: OPTIONS,
        })
      )
    ).toBeNull();
  });
});
