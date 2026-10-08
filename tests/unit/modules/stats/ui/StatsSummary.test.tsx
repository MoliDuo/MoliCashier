import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsSummary } from "@/modules/stats/ui/StatsSummary";
import { deriveStatsInsights } from "@/modules/stats/lib/derived-insights";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import { expectAmountVariant } from "tests/helpers/class-tables";

function propsFor(stats = buildEnhancedStatsFixture()) {
  return {
    total: stats.summary.total,
    dailyAverage: stats.summary.dailyAverage,
    currencySymbol: "CNY",
    comparison: stats.summary.comparison,
    periodLabel: "上月",
    insights: deriveStatsInsights(stats),
  };
}

/** Six days of August, ¥10 a day and a ¥600 day among them, with the month still running. */
function augustWithOneBigDay() {
  return buildEnhancedStatsFixture({
    periodEnd: "2026-08-31",
    summary: { ...buildEnhancedStatsFixture().summary, total: "650", dailyAverage: "108.33" },
    categories: [
      {
        id: "home",
        name: "Home",
        icon: null,
        totalConverted: "650",
        currency: "CNY",
        percent: 100,
        count: 6,
        trend: { percent: 0, amount: "0" },
      },
    ],
    chart: ["01", "02", "03", "04", "05", "06"].map((day) => ({
      date: `2026-08-${day}`,
      total: day === "03" ? "600" : "10",
    })),
  });
}

describe("StatsSummary", () => {
  it("leads with the total at the shared hero size", () => {
    render(<StatsSummary {...propsFor()} />);

    expectAmountVariant(screen.getByText("¥120.00"), "hero");
  });

  it("sets the typical day beside the average, which one big day pulls up", () => {
    render(<StatsSummary {...propsFor(augustWithOneBigDay())} />);

    expect(screen.getByText("日均支出").nextElementSibling).toHaveTextContent("¥108.33");
    expect(screen.getByText("典型日支出").nextElementSibling).toHaveTextContent("¥10.00");
    expect(screen.getByText("笔数").nextElementSibling).toHaveTextContent("6");
  });

  it("forecasts where a running period is heading", () => {
    // ¥650 so far, and 25 more days of August at a typical ¥10.
    render(<StatsSummary {...propsFor(augustWithOneBigDay())} />);

    expect(screen.getByText("预计本期").nextElementSibling).toHaveTextContent("¥900.00");
  });

  it("shows the simulated forecast and its spread when there is one", () => {
    render(
      <StatsSummary
        {...propsFor(augustWithOneBigDay())}
        forecast={{ p10: "820.00", p50: "880.50", p90: "990.00" }}
      />
    );

    const label = screen.getByText("预计本期");
    expect(label.nextElementSibling).toHaveTextContent("¥880.50");
    expect(label).toHaveAttribute("title", "八成可能落在 ¥820.00–¥990.00");
  });

  it("does not forecast a period that is over", () => {
    const base = augustWithOneBigDay();
    const stats = {
      ...base,
      summary: {
        ...base.summary,
        comparison: { ...base.summary.comparison, mode: "full_period" as const },
      },
    };
    render(<StatsSummary {...propsFor(stats)} />);

    expect(screen.queryByText("预计本期")).not.toBeInTheDocument();
  });

  it("compares with the change and its percentage", () => {
    render(<StatsSummary {...propsFor()} />);

    expect(screen.getByText("较上月同期多 ¥60.00（+100.0%）")).toBeInTheDocument();
  });

  it("gives no percentage against a period that came to nothing", () => {
    const base = buildEnhancedStatsFixture();
    const stats = buildEnhancedStatsFixture({
      summary: {
        ...base.summary,
        comparison: {
          ...base.summary.comparison,
          previousTotal: "0",
          amountDelta: "120",
          percent: null,
        },
      },
    });
    render(<StatsSummary {...propsFor(stats)} />);

    expect(screen.getByText("较上月同期多 ¥120.00")).toBeInTheDocument();
  });
});
