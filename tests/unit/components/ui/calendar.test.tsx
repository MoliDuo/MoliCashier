import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Calendar } from "@/components/ui/calendar";
import { calendarCopy } from "@/copy/controls";

describe("Calendar", () => {
  it("changes months and resets the view when the controlled value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Calendar value={new Date(2026, 0, 15)} onChange={onChange} showShortcuts={false} />
    );

    expect(screen.getByText("2026年1月")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(screen.getByText("2026年2月")).toBeInTheDocument();

    rerender(<Calendar value={new Date(2026, 2, 20)} onChange={onChange} showShortcuts={false} />);
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
  });

  it("uses the standard grid keyboard model and selects with Enter", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Calendar value={new Date(2026, 0, 15)} onChange={onChange} showShortcuts={false} />
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-01-15"]'
    );
    expect(selected).not.toBeNull();

    selected?.focus();
    fireEvent.keyDown(selected!, { key: "ArrowRight" });

    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("data-calendar-date", "2026-01-16")
    );
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 0, 16));
  });

  it("disables today and yesterday shortcuts outside the allowed range", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    render(<Calendar value={null} onChange={() => {}} minDate={tomorrow} />);

    expect(screen.getByRole("button", { name: calendarCopy.today })).toBeDisabled();
    expect(screen.getByRole("button", { name: calendarCopy.yesterday })).toBeDisabled();
  });

  it("delegates Escape so the owning popover can restore focus", () => {
    const onEscape = vi.fn();
    const { container } = render(
      <Calendar
        value={new Date(2026, 0, 15)}
        onChange={() => {}}
        onEscape={onEscape}
        showShortcuts={false}
      />
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-01-15"]'
    );
    fireEvent.keyDown(selected!, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it("names today and yesterday by the ledger's day, not the device's", () => {
    const onChange = vi.fn();
    render(<Calendar value={null} onChange={onChange} today="2026-03-01" />);

    expect(screen.getByText("2026年3月")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026年3月1日星期日" })).toHaveAttribute(
      "aria-current",
      "date"
    );
    fireEvent.click(screen.getByRole("button", { name: calendarCopy.today }));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 2, 1));
    fireEvent.click(screen.getByRole("button", { name: calendarCopy.yesterday }));
    expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 1, 28));
  });

  it("lays the month out in Monday-first week rows", () => {
    render(<Calendar value={new Date(2026, 0, 15)} onChange={() => {}} showShortcuts={false} />);

    const [header, firstWeek] = screen.getAllByRole("row");
    expect(header).toHaveTextContent("一二三四五六日");
    // 2026-01-01 is a Thursday, so the first row opens on Monday 29 December.
    const firstDay = firstWeek!.querySelector("button");
    expect(firstDay).toHaveAttribute("data-calendar-date", "2025-12-29");
    expect(firstDay).toHaveAccessibleName("2025年12月29日星期一");
    expect(firstWeek!.querySelectorAll('[role="gridcell"]')).toHaveLength(7);
  });

  it("moves Home and End to the Monday and Sunday of the week", async () => {
    const { container } = render(
      <Calendar value={new Date(2026, 0, 15)} onChange={() => {}} showShortcuts={false} />
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-01-15"]'
    )!;

    fireEvent.keyDown(selected, { key: "Home" });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("data-calendar-date", "2026-01-12")
    );
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("data-calendar-date", "2026-01-18")
    );
  });
});
