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
    largePurchaseFrom: null,
    upcoming: [],
    anomalies: [],
    model: null,
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
        onCategoryClick={open}
      />
    );

    expect(screen.getByRole("heading", { name: "分类预测" })).toBeInTheDocument();
    // The panel is about categories; the comparison with last month is left to the summary.
    expect(screen.queryByText(/超过上月/)).not.toBeInTheDocument();
    const food = screen.getByRole("button", {
      name: "餐饮, 预计 ¥1,800.00, ¥1,500.00–¥2,100.00, 已花 ¥300.00",
    });
    expect(screen.getByRole("button", { name: /^未分类, 预计 ¥120.00/ })).toBeInTheDocument();
    expect(screen.getByText("30 天前的一天只算昨天的一半", { exact: false })).toBeInTheDocument();

    fireEvent.click(food);
    expect(open).toHaveBeenCalledWith("food");
  });

  it("renders nothing with no categories, and no buttons without a drilldown", () => {
    const { container, rerender } = render(
      <StatsCategoryForecast
        forecast={forecastFixture({ exceedPrevious: null })}
        currencySymbol="CNY"
      />
    );
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(
      true
    );

    rerender(
      <StatsCategoryForecast forecast={forecastFixture({ categories: [] })} currencySymbol="CNY" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists the bills expected before the period ends, with how they come back", () => {
    render(
      <StatsCategoryForecast
        forecast={forecastFixture({
          upcoming: [
            {
              id: "home",
              name: "居住",
              icon: null,
              date: "2026-10-15",
              label: "房租",
              amount: "1200.00",
              cadence: "monthly",
              streak: 6,
            },
          ],
        })}
        currencySymbol="CNY"
      />
    );

    expect(screen.getByText("接下来大概会有")).toBeInTheDocument();
    expect(screen.getByText("10/15 房租 约 ¥1,200.00")).toBeInTheDocument();
    expect(screen.getByText("每月 · 已连续 6 次")).toBeInTheDocument();
  });

  it("says how well the forecast did on past days, and whether the network has earned a share", () => {
    const accuracy = {
      origins: 6,
      horizonDays: 14,
      error: 0.114,
      statisticalError: 0.13,
      networkError: 0.1,
      typicalDayError: 0.3,
    };
    const { rerender } = render(
      <StatsCategoryForecast
        forecast={forecastFixture({
          model: { trainedFor: "2026-10-04", networkShare: 0.62, accuracy },
        })}
        currencySymbol="CNY"
      />
    );
    expect(
      screen.getByText(
        "回到过去 6 个日子各试一次：预测之后 14 天花多少，平均差约 ±11%。其中神经网络占 62%。"
      )
    ).toBeInTheDocument();

    rerender(
      <StatsCategoryForecast
        forecast={forecastFixture({
          halfLifeDays: null,
          model: { trainedFor: "2026-10-04", networkShare: 0, accuracy },
        })}
        currencySymbol="CNY"
      />
    );
    expect(screen.getByText(/神经网络还没赢过统计模型/)).toBeInTheDocument();
    expect(screen.getByText(/每一天都算得一样重/)).toBeInTheDocument();
  });

  it("says how large a single purchase must be to be left out of the forecast", () => {
    render(
      <StatsCategoryForecast
        forecast={forecastFixture({ largePurchaseFrom: "1250.00" })}
        currencySymbol="CNY"
      />
    );

    expect(screen.getByText(/单笔 ¥1,250 以上的一次性大额不预测，记了才算。/)).toBeInTheDocument();
  });
});
