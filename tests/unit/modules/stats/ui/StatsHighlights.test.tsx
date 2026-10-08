import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsHighlights } from "@/modules/stats/ui/StatsHighlights";
import type { StatsInsights } from "@/modules/stats/lib/derived-insights";

function insights(overrides: Partial<StatsInsights> = {}): StatsInsights {
  return {
    entryCount: 0,
    typicalDaily: "0",
    forecast: null,
    busiestDay: null,
    topMover: null,
    ...overrides,
  };
}

describe("StatsHighlights", () => {
  it("stays out of the way when there is nothing to point at", () => {
    const { container } = render(
      <StatsHighlights insights={insights()} currencySymbol="CNY" periodLabel="上月" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("opens the day that cost the most", () => {
    // The day behind a lopsided period comparison is the one worth checking,
    // so naming it is only half the job.
    const onDateDrilldown = vi.fn();
    render(
      <StatsHighlights
        insights={insights({ busiestDay: { date: "2026-09-01", total: "2200" } })}
        currencySymbol="CNY"
        periodLabel="上月"
        onDateDrilldown={onDateDrilldown}
      />
    );

    expect(screen.getByText("¥2,200.00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "9/1" }));
    expect(onDateDrilldown).toHaveBeenCalledWith("2026-09-01");
  });

  it("names the biggest change in whole units of money, not in percent", () => {
    render(
      <StatsHighlights
        insights={insights({
          topMover: { id: "edu", name: "Education", amountDelta: "2072", direction: "up" },
        })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );

    expect(screen.getByText("Education 比上月多花了 ¥2,072")).toBeVisible();
  });

  it("reads a fall as a fall", () => {
    render(
      <StatsHighlights
        insights={insights({
          topMover: { id: "edu", name: "Education", amountDelta: "2072", direction: "down" },
        })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );

    expect(screen.getByText("Education 比上月少花了 ¥2,072")).toBeVisible();
  });

  it("names the entries without a category when they changed the most", () => {
    render(
      <StatsHighlights
        insights={insights({
          topMover: { id: null, name: null, amountDelta: "300", direction: "up" },
        })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );

    expect(screen.getByText("未分类 比上月多花了 ¥300")).toBeVisible();
  });

  it("names the days that cost a category far more than usual", () => {
    render(
      <StatsHighlights
        insights={insights()}
        anomalies={[
          {
            id: "food",
            name: "餐饮",
            icon: null,
            date: "2026-10-02",
            amount: "180.00",
            typical: "25.00",
          },
        ]}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );

    expect(screen.getByText("不寻常的日子")).toBeVisible();
    expect(screen.getByText("10/2 餐饮 ¥180，平时一天约 ¥25")).toBeVisible();
  });
});
