import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodPicker } from "@/modules/workspace/ui/PeriodPicker";
import { MAX_PERIOD_DAYS } from "@/modules/ledger/domain/period";
import { periodBarCopy } from "@/copy/controls";

const TODAY = "2026-09-27";

describe("PeriodPicker", () => {
  it("names the months of the period's year and picks one", async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker period={{ range: "month", offset: -3 }} today={TODAY} onChange={onChange} />
    );

    expect(screen.getByRole("button", { name: "月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2026年6月" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // A month ahead holds the bills dated ahead.
    expect(screen.getByRole("button", { name: "2026年10月" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "上一年" }));
    await userEvent.click(screen.getByRole("button", { name: "2025年12月" }));
    expect(onChange).toHaveBeenCalledWith({ range: "month", offset: -9 });
  });

  it("steps the shown year no further than a period reaches", async () => {
    render(
      <PeriodPicker period={{ range: "month", offset: 0 }} today={TODAY} onChange={vi.fn()} />
    );

    const forward = screen.getByRole("button", { name: "下一年" });
    await userEvent.click(forward);
    expect(screen.getByText("2027年")).toBeInTheDocument();
    expect(forward).toBeDisabled();
    expect(screen.getByRole("button", { name: "2027年9月" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2027年10月" })).toBeDisabled();

    const back = screen.getByRole("button", { name: "上一年" });
    await userEvent.click(back);
    for (let step = 0; step < 10; step += 1) await userEvent.click(back);
    expect(screen.getByText("2016年")).toBeInTheDocument();
    expect(back).toBeDisabled();
    expect(screen.getByRole("button", { name: "2016年9月" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2016年10月" })).toBeEnabled();
  });

  it("switches the kind of period without applying it until one is picked", async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker period={{ range: "month", offset: 0 }} today={TODAY} onChange={onChange} />
    );

    await userEvent.click(screen.getByRole("button", { name: "周" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "9月14日 – 20日" }));
    expect(onChange).toHaveBeenCalledWith({ range: "week", offset: -1 });

    await userEvent.click(screen.getByRole("button", { name: "年" }));
    expect(screen.getByRole("button", { name: "2017年" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "2016年" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2027年" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "2028年" })).not.toBeInTheDocument();
  });

  it("applies 全部 at once, and two named days from their own apply", async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker period={{ range: "month", offset: 0 }} today={TODAY} onChange={onChange} />
    );

    await userEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(onChange).toHaveBeenLastCalledWith({ range: "all" });

    await userEvent.click(screen.getByRole("button", { name: "自定义" }));
    await userEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onChange).toHaveBeenLastCalledWith({
      range: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("refuses a custom span longer than one read covers, and says so", async () => {
    const onChange = vi.fn();
    render(
      <PeriodPicker
        period={{ range: "custom", from: "2010-01-01", to: TODAY }}
        today={TODAY}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      periodBarCopy.customTooLong({ days: MAX_PERIOD_DAYS })
    );
    const apply = screen.getByRole("button", { name: periodBarCopy.apply });
    expect(apply).toBeDisabled();
    await userEvent.click(apply);
    expect(onChange).not.toHaveBeenCalled();
  });
});
