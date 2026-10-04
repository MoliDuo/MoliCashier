import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsCumulativeChart } from "@/modules/stats/ui/StatsCumulativeChart";

const september = {
  data: [
    { date: "2026-09-01", total: "30" },
    { date: "2026-09-05", total: "3000" },
  ],
  range: { from: "2026-09-01", to: "2026-09-10" },
  periodEnd: "2026-09-30",
  currencySymbol: "CNY",
};

const august = {
  data: [
    { date: "2026-08-02", total: "100" },
    { date: "2026-08-31", total: "400" },
  ],
  from: "2026-08-01",
  to: "2026-08-31",
  total: "500",
  label: "上月",
};

describe("StatsCumulativeChart", () => {
  it("sums the period so far and names where it and the last one end", () => {
    render(<StatsCumulativeChart {...september} forecast="3630" previous={august} />);

    expect(
      screen.getByRole("img", { name: "累计支出：本期 ¥3,030.00，预计 ¥3,630.00，上月 ¥500.00" })
    ).toBeInTheDocument();
  });

  it("forecasts nothing for a period that is over", () => {
    render(
      <StatsCumulativeChart
        {...september}
        range={{ from: "2026-09-01", to: "2026-09-30" }}
        forecast={null}
        previous={null}
      />
    );

    expect(screen.getByRole("img")).toHaveAccessibleName("累计支出：本期 ¥3,030.00");
    expect(screen.queryByText("预计")).not.toBeInTheDocument();
  });

  it("steps through the days from the keyboard, the last period's same point beside", () => {
    render(<StatsCumulativeChart {...september} forecast="3630" previous={august} />);
    const plot = screen.getByRole("img");

    plot.focus();
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    // The 9th: ¥3,030 so far, and August a little over a quarter through.
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("9/9")).toBeVisible();
    expect(within(tooltip).getByText("本期 ¥3,030.00")).toBeVisible();
    expect(within(tooltip).getByText("上月 ¥100.00")).toBeVisible();

    for (let day = 0; day < 5; day++) fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(within(screen.getByRole("tooltip")).getByText(/^预计 /)).toBeVisible();
  });

  it("draws the forecast's spread for the days left and reads it in the tooltip", () => {
    // Twenty days left, at 10 to 30 a day around a middle of 20.
    const band = Array.from({ length: 20 }, (_, index) => ({
      p10: String(3030 + 10 * (index + 1)),
      p50: String(3030 + 20 * (index + 1)),
      p90: String(3030 + 30 * (index + 1)),
    }));
    render(
      <StatsCumulativeChart {...september} forecast="9999" forecastBand={band} previous={null} />
    );
    const plot = screen.getByRole("img");

    // The band's last middle replaces the typical-day forecast.
    expect(plot).toHaveAccessibleName(
      "累计支出：本期 ¥3,030.00，预计 ¥3,430.00，¥3,230.00–¥3,630.00"
    );
    plot.focus();
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("预计 ¥3,050.00")).toBeVisible();
    expect(within(tooltip).getByText("¥3,040.00–¥3,060.00")).toBeVisible();
  });

  it("marks the day the way of spending changed when it falls among the days recorded", () => {
    const { rerender } = render(
      <StatsCumulativeChart
        {...september}
        forecast={null}
        changeDate="2026-09-03"
        previous={null}
      />
    );
    expect(screen.getByTestId("cumulative-change-marker")).toBeInTheDocument();
    const plot = screen.getByRole("img");
    plot.focus();
    for (let day = 0; day < 7; day++) fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(within(screen.getByRole("tooltip")).getByText("9/3")).toBeVisible();
    expect(within(screen.getByRole("tooltip")).getByText("花钱的样子从这天起变了")).toBeVisible();

    // Before the period, on its first day, or after today, there is nothing to mark.
    for (const changeDate of ["2026-08-20", "2026-09-01", "2026-09-20"]) {
      rerender(
        <StatsCumulativeChart
          {...september}
          forecast={null}
          changeDate={changeDate}
          previous={null}
        />
      );
      expect(screen.queryByTestId("cumulative-change-marker")).not.toBeInTheDocument();
    }
  });

  it("ignores a band that does not cover the days left", () => {
    render(
      <StatsCumulativeChart
        {...september}
        forecast="3630"
        forecastBand={[{ p10: "1", p50: "2", p90: "3" }]}
        previous={null}
      />
    );

    expect(screen.getByRole("img")).toHaveAccessibleName(
      "累计支出：本期 ¥3,030.00，预计 ¥3,630.00"
    );
  });
});
