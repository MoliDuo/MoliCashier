import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ForecastDto } from "@/modules/forecast/contracts";
import { StatsCategoryForecast } from "@/modules/stats/ui/StatsCategoryForecast";

function forecastFixture(overrides: Partial<ForecastDto> = {}): ForecastDto {
  return {
    asOf: "2026-10-04",
    periodEnd: "2026-10-31",
    currency: "CNY",
    historyFrom: "2026-01-02",
    halfLifeDays: 30,
    spent: "400",
    total: { p10: "2000.00", p50: "2400.00", p90: "2900.00" },
    running: [],
    categories: [
      {
        id: "food",
        name: "餐饮",
        icon: null,
        spent: "300",
        forecast: { p10: "1500.00", p50: "1800.00", p90: "2100.00" },
      },
      {
        id: null,
        name: null,
        icon: null,
        spent: "100",
        forecast: { p10: "100.00", p50: "120.00", p90: "200.00" },
      },
    ],
    exceedPrevious: { total: "2200", probability: 0.684 },
    lifeChange: null,
    ...overrides,
  };
}

describe("StatsCategoryForecast", () => {
  it("lists each category's expected end, spread and spending so far", () => {
    const open = vi.fn();
    render(
      <StatsCategoryForecast
        forecast={forecastFixture()}
        currencySymbol="CNY"
        periodLabel="上月"
        onCategoryClick={open}
      />
    );

    expect(screen.getByRole("heading", { name: "分类预测" })).toBeInTheDocument();
    expect(screen.getByText("超过上月（¥2,200.00）的可能约 68%")).toBeInTheDocument();
    const food = screen.getByRole("button", {
      name: "餐饮, 预计 ¥1,800.00, 八成在 ¥1,500.00–¥2,100.00, 已花 ¥300.00",
    });
    expect(screen.getByRole("button", { name: /^未分类, 预计 ¥120.00/ })).toBeInTheDocument();
    expect(screen.getByText("30 天前的一天只算昨天的一半", { exact: false })).toBeInTheDocument();

    fireEvent.click(food);
    expect(open).toHaveBeenCalledWith("food");
  });

  it("says when the way of spending changed and how much a day it went from and to", () => {
    render(
      <StatsCategoryForecast
        forecast={forecastFixture({
          lifeChange: { date: "2026-09-01", dailyBefore: "210.00", dailyAfter: "65.50" },
        })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );

    expect(
      screen.getByText("9月1日起花钱的样子变了（日均 ¥210.00 → ¥65.50），之前的日子只作参考。")
    ).toBeInTheDocument();
  });

  it("leaves the comparison out without one, and renders nothing with no categories", () => {
    const { container, rerender } = render(
      <StatsCategoryForecast
        forecast={forecastFixture({ exceedPrevious: null })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );
    expect(screen.queryByText(/超过上月/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(
      true
    );

    rerender(
      <StatsCategoryForecast
        forecast={forecastFixture({ categories: [] })}
        currencySymbol="CNY"
        periodLabel="上月"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
