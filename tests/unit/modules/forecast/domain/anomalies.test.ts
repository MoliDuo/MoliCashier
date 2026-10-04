import { describe, expect, it } from "vitest";
import { findAnomalies } from "@/modules/forecast/domain/anomalies";
import { prepareHistory } from "@/modules/forecast/domain/history";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays } from "@/modules/ledger/domain/period";

/** Lunch every day of September at 20 to 30, then October so far. */
function lunches(october: Record<string, string>): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (let day = 0; day < 30; day++) {
    rows.push({
      date: addCivilDays("2026-09-01", day),
      categoryId: "lunch",
      currency: "CNY",
      amount: String(20 + (day % 11)),
    });
  }
  for (const [date, amount] of Object.entries(october)) {
    rows.push({ date, categoryId: "lunch", currency: "CNY", amount });
  }
  return rows;
}

function anomaliesOf(rows: HistoryRow[], today: string) {
  return findAnomalies({
    rows,
    history: prepareHistory(rows, today, 7)!,
    from: "2026-10-01",
    halfLifeDays: 30,
  });
}

describe("findAnomalies", () => {
  it("names a day that cost a category far more than its usual day, today included", () => {
    const rows = lunches({ "2026-10-01": "25", "2026-10-02": "180", "2026-10-03": "90" });

    expect(anomaliesOf(rows, "2026-10-03")).toEqual([
      { date: "2026-10-02", key: "lunch", amount: 180, typical: 25 },
      { date: "2026-10-03", key: "lunch", amount: 90, typical: 25 },
    ]);
  });

  it("finds nothing in an ordinary period, or with too little before it", () => {
    expect(anomaliesOf(lunches({ "2026-10-01": "29", "2026-10-02": "21" }), "2026-10-02")).toEqual(
      []
    );
    const short = lunches({ "2026-10-02": "500" }).filter((row) => row.date >= "2026-09-25");
    expect(anomaliesOf(short, "2026-10-02")).toEqual([]);
  });
});
