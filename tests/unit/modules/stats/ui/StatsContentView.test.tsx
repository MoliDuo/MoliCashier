import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const { openLedgerEntrySourceDocumentMock } = vi.hoisted(() => ({
  openLedgerEntrySourceDocumentMock: vi.fn(),
}));

vi.mock("@/lib/navigation/ledger-detail-navigation", () => ({
  openLedgerEntrySourceDocument: openLedgerEntrySourceDocumentMock,
}));

import { StatsContentView } from "@/modules/stats/ui/StatsContentView";
import { buildEnhancedStatsFixture } from "tests/helpers/stats-fixture";
import type { ForecastDto } from "@/modules/forecast/contracts";

const baseProps = {
  periodBar: <div>period bar</div>,
  range: { from: "2026-08-01", to: "2026-08-06" },
  scale: "month" as const,
  comparisonLabel: "上月",
  stats: undefined,
  chartView: "heatmap" as const,
  onChartViewChange: () => {},
  fallbackCurrency: "CNY",
};

const statsFixture = buildEnhancedStatsFixture();

describe("StatsContentView", () => {
  it("shows an error panel instead of zero totals when the query failed without data", () => {
    render(<StatsContentView {...baseProps} isError onRetry={() => {}} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("统计数据加载失败，请重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText("总支出")).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });

  it("keeps stale data and shows an inline warning when a refresh fails", () => {
    render(<StatsContentView {...baseProps} stats={statsFixture} isError />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("总支出")).toBeInTheDocument();
    expect(screen.getByText("¥120.00")).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<StatsContentView {...baseProps} isError onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("switches between the daily, running-total and calendar views", () => {
    function Harness() {
      const [chartView, setChartView] = useState<"trend" | "cumulative" | "heatmap">("heatmap");
      return (
        <StatsContentView
          {...baseProps}
          stats={statsFixture}
          chartView={chartView}
          onChartViewChange={setChartView}
        />
      );
    }
    render(<Harness />);

    const views = screen.getByRole("group", { name: "图表视图" });
    const heatmap = within(views).getByRole("button", { name: "日历" });
    const daily = within(views).getByRole("button", { name: "每日" });
    const cumulative = within(views).getByRole("button", { name: "累计" });
    expect(heatmap).toHaveAttribute("aria-pressed", "true");
    expect(daily).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(daily);
    expect(daily).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "支出趋势" })).toBeVisible();

    fireEvent.click(cumulative);
    expect(cumulative).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "累计支出" })).toBeVisible();
    expect(heatmap).toHaveAttribute("aria-pressed", "false");
  });

  it("names the comparison it was given, and hides it when there is none", () => {
    const { rerender } = render(
      <StatsContentView {...baseProps} comparisonLabel="去年" stats={statsFixture} />
    );
    expect(screen.getByText(/去年/)).toBeInTheDocument();
    expect(screen.getByText("period bar")).toBeInTheDocument();

    rerender(<StatsContentView {...baseProps} comparisonLabel={null} stats={statsFixture} />);
    expect(screen.queryByText(/较.*同期/)).not.toBeInTheDocument();
  });

  it("shows the ranking beside the chosen view rather than behind it", () => {
    // The ranking used to sit below a full-width heatmap, off the bottom of a
    // desktop screen. Both panels are now on the page at once.
    render(<StatsContentView {...baseProps} stats={statsFixture} />);

    expect(screen.getByRole("heading", { name: "每日热力图" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "支出排行" })).toBeVisible();
  });

  it("lists the period's biggest entries and opens the record behind one", () => {
    const stats = buildEnhancedStatsFixture({
      largestEntries: [
        {
          id: "e1",
          sourceDocumentId: "d1",
          name: "Deposit",
          categoryName: "Home",
          categoryIcon: null,
          date: "2026-08-03",
          amount: "3000",
          originalAmount: "1800",
          originalCurrency: "MYR",
        },
      ],
    });
    render(<StatsContentView {...baseProps} stats={stats} />);

    const row = screen.getByRole("button", { name: /Deposit/ });
    expect(row).toHaveAccessibleName(/¥3,000\.00/);
    expect(within(row).getByText(/1,800\.00/)).toBeVisible();
    expect(within(row).queryByText(/原币/)).toBeNull();
    fireEvent.click(row);
    expect(openLedgerEntrySourceDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDocumentId: "d1" })
    );
  });

  it("leaves the biggest entries out when there are none", () => {
    render(<StatsContentView {...baseProps} stats={statsFixture} />);

    expect(screen.queryByRole("heading", { name: "最大几笔" })).not.toBeInTheDocument();
  });

  it("shows the AI's phases of life, and what it judged a big purchase to be", () => {
    const stats = buildEnhancedStatsFixture({
      largestEntries: [
        {
          id: "e1",
          sourceDocumentId: "d1",
          name: "Tuition",
          categoryName: "Education",
          categoryIcon: null,
          date: "2026-08-03",
          amount: "4000",
          originalAmount: "4000",
          originalCurrency: "CNY",
        },
      ],
    });
    const forecast: ForecastDto = {
      asOf: "2026-08-06",
      periodEnd: "2026-08-31",
      currency: "CNY",
      historyFrom: "2026-01-02",
      halfLifeDays: 30,
      spent: "4120",
      total: { p10: "5000.00", p50: "5200.00", p90: "5500.00" },
      running: [],
      categories: [],
      exceedPrevious: null,
      lifeChange: null,
      largePurchaseFrom: null,
      upcoming: [],
      anomalies: [],
      model: null,
      judgment: {
        asOf: "2026-08-06",
        phases: [
          { from: "2026-02-01", to: "2026-07-31", label: "独居", daily: "80.00" },
          { from: "2026-08-01", to: "2026-08-05", label: "读博", daily: "120.00" },
        ],
        documents: [{ documentId: "d1", kind: "recurring", cadence: "semester" }],
        accuracy: null,
      },
    };
    render(<StatsContentView {...baseProps} stats={stats} forecast={forecast} />);

    expect(screen.getByRole("heading", { name: "生活阶段" })).toBeInTheDocument();
    expect(screen.getByText("现在")).toBeInTheDocument();
    expect(screen.getByText("日常 ¥120/天")).toBeInTheDocument();
    expect(screen.getByText("2026/2/1–2026/7/31")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tuition/ })).toHaveAccessibleName(/每学期/);
  });
});
