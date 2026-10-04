import { describe, expect, it } from "vitest";
import { buildDailySeries, weekdayOf } from "@/modules/forecast/domain/series";

describe("buildDailySeries", () => {
  it("lays each category's days out in a row, summing currencies and leaving out other days", () => {
    const series = buildDailySeries(
      [
        { date: "2026-10-01", categoryId: "food", currency: "CNY", amount: "30" },
        { date: "2026-10-01", categoryId: "food", currency: "MYR", amount: "12.5" },
        { date: "2026-10-03", categoryId: null, currency: "CNY", amount: "-8" },
        { date: "2026-09-30", categoryId: "food", currency: "CNY", amount: "99" },
        { date: "2026-10-04", categoryId: "food", currency: "CNY", amount: "99" },
      ],
      "2026-10-01",
      "2026-10-03"
    );

    expect(series.length).toBe(3);
    expect(Array.from(series.byCategory.get("food")!)).toEqual([42.5, 0, 0]);
    expect(Array.from(series.byCategory.get("__uncategorized__")!)).toEqual([0, 0, -8]);
  });

  it("names weekdays from Sunday", () => {
    expect(weekdayOf("2026-10-04")).toBe(0);
    expect(weekdayOf("2026-10-05")).toBe(1);
  });
});
