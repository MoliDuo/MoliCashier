import { describe, expect, it } from "vitest";
import {
  networkShareOf,
  runBacktest,
  type BacktestOptions,
} from "@/modules/forecast/domain/backtest";
import { seededRandom } from "@/modules/forecast/domain/random";
import { weekdayOf, type HistoryRow } from "@/modules/forecast/domain/series";
import { trainForecast } from "@/modules/forecast/domain/training";
import { addCivilDays } from "@/modules/ledger/domain/period";

const OPTIONS: BacktestOptions = {
  halfLives: [14, 60, null],
  changeDiscount: 0.2,
  origins: 4,
  spacing: 7,
  horizon: 14,
  paths: 200,
  seed: 3,
  minHistoryDays: 7,
  network: null,
};

const NETWORK = {
  hidden: [8],
  maxEpochs: 15,
  patience: 4,
  batchSize: 64,
  learningRate: 0.02,
  l2: 1e-4,
  validationDays: 14,
};

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (step.done !== true) step = steps.next();
  return step.value;
}

/** `days` days from `from` of lunch around `level`, and an outing at weekends. */
function history(from: string, days: number, level: number, seed = 1): HistoryRow[] {
  const random = seededRandom(seed);
  const rows: HistoryRow[] = [];
  for (let day = 0; day < days; day++) {
    const date = addCivilDays(from, day);
    rows.push({
      date,
      categoryId: "lunch",
      currency: "CNY",
      amount: (level * (0.7 + random() * 0.6)).toFixed(2),
    });
    if (weekdayOf(date) === 6) {
      rows.push({ date, categoryId: "outing", currency: "CNY", amount: (level * 3).toFixed(2) });
    }
  }
  return rows;
}

describe("runBacktest", () => {
  it("scores the statistical model against the typical day on the days stood on", () => {
    const rows = history("2026-06-01", 120, 30);

    const result = finish(runBacktest(rows, "2026-09-29", OPTIONS))!;

    expect(result.origins).toBe(4);
    expect(result.horizon).toBe(14);
    expect(OPTIONS.halfLives).toContain(result.halfLifeDays);
    // A steady ledger is forecast well, and better than the typical day that leaves the weekends out.
    expect(result.statistical.error).toBeLessThan(0.15);
    expect(result.statistical.error).toBeLessThan(result.typicalDay.error);
    // Without the network there is nothing to mix.
    expect(result.network).toBeNull();
    expect(result.networkShare).toBe(0);
    expect(result.ensemble).toEqual(result.statistical);
  });

  it("prefers a short half-life once spending has settled at a new level", () => {
    const rows = [...history("2026-03-01", 150, 100), ...history("2026-07-29", 60, 30, 2)];

    const result = finish(runBacktest(rows, "2026-09-27", OPTIONS))!;

    expect(result.halfLifeDays).not.toBeNull();
  });

  it("enters the network, and trusts it only with what it earned", () => {
    const rows = history("2026-06-01", 120, 30);

    const result = finish(runBacktest(rows, "2026-09-29", { ...OPTIONS, network: NETWORK }))!;

    expect(result.network).not.toBeNull();
    expect(result.networkShare).toBeGreaterThanOrEqual(0);
    expect(result.networkShare).toBeLessThan(1);
    if (result.network!.loss >= result.statistical.loss) expect(result.networkShare).toBe(0);
  });

  it("has nothing to say with too few past days to stand on", () => {
    expect(finish(runBacktest(history("2026-09-01", 20, 30), "2026-09-21", OPTIONS))).toBeNull();
  });
});

describe("trainForecast", () => {
  it("keeps the contest's half-life and the change it saw, and trains the network only if it won", () => {
    const rows = history("2026-06-01", 120, 30);

    const trained = finish(
      trainForecast(rows, "2026-09-29", {
        backtest: { ...OPTIONS, network: NETWORK },
        defaultHalfLifeDays: 30,
      })
    );

    expect(trained.asOf).toBe("2026-09-29");
    expect(trained.changeDate).toBeNull();
    expect(trained.halfLifeDays).toBe(trained.backtest!.halfLifeDays);
    expect(trained.network == null).toBe(trained.backtest!.networkShare === 0);
    expect(trained.networkShare).toBe(trained.backtest!.networkShare);
  });

  it("falls back to the default half-life without a contest", () => {
    const trained = finish(
      trainForecast(history("2026-09-01", 20, 30), "2026-09-21", {
        backtest: OPTIONS,
        defaultHalfLifeDays: 30,
      })
    );

    expect(trained).toEqual({
      asOf: "2026-09-21",
      changeDate: null,
      halfLifeDays: 30,
      network: null,
      networkShare: 0,
      backtest: null,
    });
  });
});

describe("networkShareOf", () => {
  it("gives the network a share in proportion to how much better it did, and none otherwise", () => {
    expect(networkShareOf(3, 1)).toBe(0.75);
    expect(networkShareOf(1, 1)).toBe(0);
    expect(networkShareOf(1, 2)).toBe(0);
    expect(networkShareOf(1, null)).toBe(0);
  });

  it("gives no share when either loss is not a number", () => {
    expect(networkShareOf(1, Number.NaN)).toBe(0);
    expect(networkShareOf(Number.NaN, 1)).toBe(0);
    expect(networkShareOf(Number.POSITIVE_INFINITY, 1)).toBe(0);
  });
});
