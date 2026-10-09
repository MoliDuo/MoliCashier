import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ForecastDto } from "@/modules/forecast/contracts";
import { StatsCategoryForecast } from "@/modules/stats/ui/StatsCategoryForecast";

function forecastFixture(overrides: Partial<ForecastDto> = {}): ForecastDto {
  return {
    asOf: "2026-10-04",
    periodEnd: "2026-10-31",
    currency: "CNY",
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
    lifeChange: null,
    anomalies: [],
    judgment: null,
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

    fireEvent.click(food);
    expect(open).toHaveBeenCalledWith("food");
  });

  it("renders nothing with no categories, and no buttons without a drilldown", () => {
    const { container, rerender } = render(
      <StatsCategoryForecast forecast={forecastFixture()} currencySymbol="CNY" />
    );
    expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(
      true
    );

    rerender(
      <StatsCategoryForecast forecast={forecastFixture({ categories: [] })} currencySymbol="CNY" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
