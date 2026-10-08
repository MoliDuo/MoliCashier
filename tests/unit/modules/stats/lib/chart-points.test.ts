import { afterEach, describe, expect, it } from "vitest";
import { buildChartPoints } from "@/modules/stats/lib/chart-points";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

describe("buildChartPoints", () => {
  it("generates all 12 months for a historical year", () => {
    const points = buildChartPoints({
      data: [
        { date: "2025-01-15", total: "10" },
        { date: "2025-01-31", total: "5" },
        { date: "2025-12-01", total: "7" },
      ],
      rangeType: "year",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      locale: "en",
    });

    expect(points).toHaveLength(12);
    expect(points[0]).toMatchObject({ fullDate: "2025-01", value: 15 });
    expect(points[1]?.fullDate).toBe("2025-02");
    expect(points[11]).toMatchObject({ fullDate: "2025-12", value: 7 });
  });

  it("stops at the endDate month for the current year", () => {
    const points = buildChartPoints({
      data: [{ date: "2026-08-03", total: "42" }],
      rangeType: "year",
      startDate: "2026-01-01",
      endDate: "2026-08-06",
      locale: "en",
    });

    expect(points).toHaveLength(8);
    expect(points[7]).toMatchObject({ fullDate: "2026-08", value: 42 });
  });

  it("generates every civil day from startDate to endDate inclusive", () => {
    const points = buildChartPoints({
      data: [{ date: "2026-02-27", total: "3" }],
      rangeType: "month",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      locale: "en",
    });

    expect(points).toHaveLength(28);
    expect(points[0]?.fullDate).toBe("2026-02-01");
    expect(points[26]).toMatchObject({ fullDate: "2026-02-27", value: 3 });
    expect(points[27]).toMatchObject({ fullDate: "2026-02-28", value: 0 });
  });

  it("keeps the last day regardless of the runtime timezone", () => {
    for (const timeZone of ["Pacific/Kiritimati", "America/New_York", "Asia/Shanghai"]) {
      process.env.TZ = timeZone;
      const points = buildChartPoints({
        data: [{ date: "2026-03-31", total: "9" }],
        rangeType: "month",
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        locale: "en",
      });

      expect(points).toHaveLength(31);
      expect(points.at(-1)).toMatchObject({ fullDate: "2026-03-31", value: 9 });
    }
  });

  it("returns an empty list for an invalid or reversed range", () => {
    expect(
      buildChartPoints({
        data: [],
        rangeType: "week",
        startDate: "2026-03-10",
        endDate: "2026-03-01",
      })
    ).toEqual([]);
    expect(
      buildChartPoints({
        data: [],
        rangeType: "month",
        startDate: "not-a-date",
        endDate: "2026-03-31",
      })
    ).toEqual([]);
  });

  it("charts a span of more than 120 months a year at a time", () => {
    const points = buildChartPoints({
      data: [
        { date: "2015-03-02", total: "10" },
        { date: "2015-11-30", total: "5.5" },
        { date: "2025-01-31", total: "7" },
      ],
      rangeType: "year",
      startDate: "2015-01-01",
      endDate: "2025-01-31",
    });

    expect(points).toHaveLength(11);
    expect(points[0]).toEqual({ label: "2015", value: 15.5, total: "15.5", fullDate: "2015" });
    expect(points[5]).toMatchObject({ fullDate: "2020", total: "0" });
    expect(points.at(-1)).toMatchObject({ fullDate: "2025", total: "7" });
  });

  it("refuses to build more than 120 daily chart points", () => {
    expect(
      buildChartPoints({
        data: [],
        rangeType: "month",
        startDate: "2026-01-01",
        endDate: "2026-05-01",
      })
    ).toEqual([]);
  });
});
