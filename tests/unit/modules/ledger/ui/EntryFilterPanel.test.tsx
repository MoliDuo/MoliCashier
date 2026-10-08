import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntryFilterPanel } from "@/modules/ledger/ui/EntryFilterPanel";

// The panel is one dialog at every width, so nothing inside it exists until the
// trigger opens it — the same way it works in the app.
async function openPanel() {
  await userEvent.click(screen.getByRole("button", { name: /^(筛选|已启用)/ }));
  return screen.getByRole("dialog", { name: "筛选" });
}

describe("EntryFilterPanel", () => {
  it("clears every filter at once beside the trigger, only while one is on", async () => {
    const onFiltersChange = vi.fn();
    const view = render(<EntryFilterPanel filters={{}} onFiltersChange={onFiltersChange} />);
    expect(screen.queryByRole("button", { name: "清除筛选" })).not.toBeInTheDocument();

    view.rerender(
      <EntryFilterPanel
        filters={{ search: "咖啡", currency: "USD" }}
        onFiltersChange={onFiltersChange}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(onFiltersChange).toHaveBeenCalledWith({
      categoryId: null,
      currency: null,
      minAmount: null,
      maxAmount: null,
      statuses: [],
      search: null,
    });
  });

  it("counts the filters that narrow the list", () => {
    const view = render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();

    view.rerender(
      <EntryFilterPanel
        filters={{ search: "咖啡" }}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    expect(screen.getByRole("button", { name: "已启用 1 个筛选" })).toBeInTheDocument();
  });

  it("leaves the period to its own bar", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    expect(screen.queryByRole("button", { name: "本月" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部" })).not.toBeInTheDocument();
  });

  it("opens a dialog and applies the shared draft", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
      />
    );

    const dialog = await openPanel();
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("搜索标题、名称或描述"), "coffee");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ search: "coffee" }));
    expect(screen.queryByRole("dialog", { name: "筛选" })).not.toBeInTheDocument();
  });

  it("applies a half-typed amount as the number it means", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    render(<EntryFilterPanel filters={{}} onFiltersChange={onFiltersChange} />);

    await openPanel();
    await user.type(screen.getByRole("textbox", { name: "最小金额" }), "007.");
    await user.type(screen.getByRole("textbox", { name: "最大金额" }), "-");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ minAmount: "7", maxAmount: null })
    );
  });

  // iOS Safari zooms the page into any field under 16px the moment it takes
  // focus, so the search box must neither grab focus nor render small on a phone.
  it("opens on its title and keeps the search box at 16px below md", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );

    const dialog = await openPanel();
    const search = screen.getByPlaceholderText("搜索标题、名称或描述");

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(search).not.toHaveFocus();
    expect(search).toHaveClass("text-base", "md:text-sm");
    expect(search).not.toHaveClass("text-sm");
  });

  it("promises a dialog rather than a dropdown", () => {
    const { container } = render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );

    expect(screen.getByRole("button", { name: "筛选" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(container.querySelector(".lucide-chevron-down")).toBeNull();
  });

  it("offers every processing status as one chip", async () => {
    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={vi.fn()}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    // The status set is a row of toggle buttons; its name is carried for screen
    // readers only, because the chips already say what they filter.
    const group = screen.getByRole("group", { name: "状态" });
    expect(group).toBeInTheDocument();
    for (const label of ["处理中", "已完成", "失败", "已取消"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(group.contains(chip)).toBe(true);
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("toggles a status off the chip itself, without a separate control", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{}}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    await user.click(screen.getByRole("button", { name: "失败" }));
    await user.click(screen.getByRole("button", { name: "已取消" }));
    expect(screen.getByRole("button", { name: "失败" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "全部状态" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual(["failed", "cancelled"]);
  });

  it("drops a status the user taps a second time", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();

    render(
      <EntryFilterPanel
        filters={{ statuses: ["processing"] }}
        onFiltersChange={onFiltersChange}
        showCategory={false}
        showCurrency={false}
      />
    );
    await openPanel();

    const chip = screen.getByRole("button", { name: "处理中" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    await user.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(onFiltersChange.mock.calls[0]?.[0].statuses).toEqual([]);
  });
});
