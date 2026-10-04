import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        samples: [],
      },
      {
        id: null,
        name: null,
        icon: null,
        spent: "100",
        forecast: { p10: "100.00", p50: "120.00", p90: "200.00" },
        samples: [],
      },
    ],
    exceedPrevious: { total: "2200", probability: 0.684 },
    lifeChange: null,
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
        periodLabel="上月"
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
        periodLabel="上月"
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
        periodLabel="上月"
      />
    );
    expect(screen.getByText(/神经网络还没赢过统计模型/)).toBeInTheDocument();
    expect(screen.getByText(/每一天都算得一样重/)).toBeInTheDocument();
  });

  it("re-adds the paths when a slider says the rest of a category goes differently", () => {
    const forecast = forecastFixture({
      spent: "400",
      categories: [
        {
          id: "food",
          name: "餐饮",
          icon: null,
          spent: "300",
          forecast: { p10: "1300.00", p50: "1300.00", p90: "1300.00" },
          samples: [1000, 1000, 1000],
        },
      ],
      exceedPrevious: { total: "1500", probability: 0 },
    });
    render(<StatsCategoryForecast forecast={forecast} currencySymbol="CNY" periodLabel="上月" />);

    expect(screen.getByText(/本期预计 ¥1,400，八成在 ¥1,400–¥1,400/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "餐饮 不变" }), {
      target: { value: "20" },
    });
    expect(screen.getByText(/本期预计 ¥1,600/)).toBeInTheDocument();
    expect(screen.getByText(/超过上月的可能约 100%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "还原" }));
    expect(screen.getByText(/本期预计 ¥1,400/)).toBeInTheDocument();
  });

  it("asks the AI only when the button is pressed, and shows what it said", async () => {
    const requestCommentary = vi
      .fn()
      .mockResolvedValue({ asOf: "2026-10-04", sentences: ["本月大概花 ¥2,400。"] });
    render(
      <StatsCategoryForecast
        forecast={forecastFixture()}
        currencySymbol="CNY"
        periodLabel="上月"
        requestCommentary={requestCommentary}
      />
    );
    expect(requestCommentary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "让 AI 说说" }));
    expect(await screen.findByText("本月大概花 ¥2,400。")).toBeInTheDocument();
    expect(requestCommentary).toHaveBeenCalledTimes(1);
  });

  it("says so when the AI could not answer, and lets it be asked again", async () => {
    const requestCommentary = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <StatsCategoryForecast
        forecast={forecastFixture()}
        currencySymbol="CNY"
        periodLabel="上月"
        requestCommentary={requestCommentary}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "让 AI 说说" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 暂时没能回答");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "让 AI 说说" })).not.toBeDisabled()
    );
  });
});
