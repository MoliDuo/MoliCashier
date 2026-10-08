import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { LedgerEntriesBatchActionToolbar } from "@/modules/ledger/ui/batch-action-toolbar";

const dining: EntryCategoryDto = {
  id: "category-1",
  name: "餐饮",
  description: null,
  icon: "Utensils",
  sortOrder: 0,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

function renderToolbar(
  overrides: Partial<React.ComponentProps<typeof LedgerEntriesBatchActionToolbar>> = {}
) {
  const props = {
    selectedCount: 0,
    isAllSelected: false,
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides,
  };
  return { ...render(<LedgerEntriesBatchActionToolbar {...props} />), props };
}

describe("LedgerEntriesBatchActionToolbar", () => {
  it("offers select all, and says so, before anything is selected", () => {
    const { props } = renderToolbar();

    expect(screen.getByText("全选")).toBeInTheDocument();
    const master = screen.getByRole("checkbox", { name: "全选" });
    expect(master).toBeEnabled();

    fireEvent.click(master);
    expect(props.onSelectAll).toHaveBeenCalledOnce();
  });

  it("selects the abnormal records with nothing selected yet, and only when there are some", () => {
    const onSelect = vi.fn();
    const { rerender, props } = renderToolbar({ selectAbnormal: { count: 2, onSelect } });

    const button = screen.getByRole("button", { name: /选中异常（2）/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(
      <LedgerEntriesBatchActionToolbar {...props} selectAbnormal={{ count: 0, onSelect }} />
    );
    expect(screen.getByRole("button", { name: /选中异常（0）/ })).toBeDisabled();
  });

  it("names what the control does and counts beside it", () => {
    renderToolbar({ selectedCount: 2, loadedCount: 5 });

    expect(screen.getByRole("checkbox", { name: "全选" })).toBeInTheDocument();
    expect(screen.getByText("已选 2 / 5")).toBeInTheDocument();
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument();
  });

  it("flips the control's words once everything loaded is selected", () => {
    renderToolbar({ selectedCount: 3, isAllSelected: true });

    expect(screen.getByRole("checkbox", { name: "取消全选" })).toBeInTheDocument();
    expect(screen.queryByText("全选")).not.toBeInTheDocument();
  });

  it("marks a partial selection as mixed", () => {
    renderToolbar({ selectedCount: 2, isAllSelected: false });

    expect(screen.getByRole("checkbox")).toHaveAttribute("data-state", "indeterminate");
  });

  it("counts against what has loaded while more pages exist", () => {
    renderToolbar({ selectedCount: 3, isAllSelected: true, hasMoreData: true });

    expect(screen.getByText("已选 3 / 已加载 3")).toBeInTheDocument();
  });

  it("keeps the actions visible but unavailable with nothing selected", () => {
    renderToolbar({ onChangeDate: vi.fn(), onDelete: vi.fn() });

    expect(screen.getByRole("button", { name: /修改日期/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /删除/ })).toBeDisabled();
  });

  it("enables the actions once something is selected", () => {
    const onDelete = vi.fn();
    renderToolbar({ selectedCount: 1, onDelete });

    const remove = screen.getByRole("button", { name: /删除/ });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("renders the actions its entity supports, in one order", () => {
    renderToolbar({
      selectedCount: 1,
      categories: [],
      onChangeCategory: vi.fn(),
      onChangeCurrency: vi.fn(),
      onChangeDate: vi.fn(),
      onDelete: vi.fn(),
    });

    // jsdom does not apply `display: none`, so a button with a mobile label
    // carries both spans here; the order is what this asserts.
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent ?? "")
      .filter((label) => label !== "");
    expect(labels).toHaveLength(4);
    ["设置分类", "修改日期", "修改货币", "删除"].forEach((label, index) => {
      expect(labels[index]).toContain(label);
    });
  });

  it("renders no action row where the surface supports no batch write", () => {
    renderToolbar({ selectedCount: 2 });

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("applies the category the picker lists, and closes it", async () => {
    const onChangeCategory = vi.fn();
    renderToolbar({ selectedCount: 1, categories: [dining], onChangeCategory });

    await userEvent.click(screen.getByRole("button", { name: /设置分类/ }));
    await userEvent.click(await screen.findByRole("button", { name: "餐饮" }));

    expect(onChangeCategory).toHaveBeenCalledWith("category-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers the uncategorized row the menu used to carry", async () => {
    const onChangeCategory = vi.fn();
    renderToolbar({ selectedCount: 1, categories: [dining], onChangeCategory });

    await userEvent.click(screen.getByRole("button", { name: /设置分类/ }));
    await userEvent.click(await screen.findByRole("button", { name: "未分类" }));

    expect(onChangeCategory).toHaveBeenCalledWith(null);
  });

  it("applies the currency the picker lists", async () => {
    const onChangeCurrency = vi.fn();
    renderToolbar({
      selectedCount: 1,
      preferredCurrencies: ["SGD"],
      onChangeCurrency,
    });

    await userEvent.click(screen.getByRole("button", { name: /修改货币/ }));
    await userEvent.click(await screen.findByRole("button", { name: "SGD" }));

    expect(onChangeCurrency).toHaveBeenCalledWith("SGD");
  });

  it("opens the confirm-based category dialog from the one category button", async () => {
    const onCategoryDialogOpenChange = vi.fn();
    renderToolbar({
      selectedCount: 1,
      categories: [dining],
      onChangeCategory: vi.fn(),
      onConfirmCategory: vi.fn(),
      onToggleCategoryPick: vi.fn(),
      onCategoryDialogOpenChange,
    });

    await userEvent.click(screen.getByRole("button", { name: /设置分类/ }));

    expect(onCategoryDialogOpenChange).toHaveBeenCalledWith(true);
  });

  it("holds the confirm until a category is picked, then names what it will do", () => {
    const { props, rerender } = renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onChangeCategory: vi.fn(),
      onConfirmCategory: vi.fn(),
      onToggleCategoryPick: vi.fn(),
      categoryDialogOpen: true,
      pickedCategoryIds: [],
    });

    expect(screen.getByText("请选择一个或多个分类")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    rerender(<LedgerEntriesBatchActionToolbar {...props} pickedCategoryIds={["category-1"]} />);

    expect(screen.getByRole("button", { name: "设为「餐饮」" })).toBeEnabled();
  });

  it("turns several picks into the model's question and accepts all 13 default categories", () => {
    const categories = Array.from({ length: 13 }, (_, index) => ({
      ...dining,
      id: `category-${index + 1}`,
      name: `分类 ${index + 1}`,
      sortOrder: index,
    }));
    const props = {
      selectedCount: 5,
      isAllSelected: false,
      onSelectAll: vi.fn(),
      onClearSelection: vi.fn(),
      categories,
      onChangeCategory: vi.fn(),
      onConfirmCategory: vi.fn(),
      onToggleCategoryPick: vi.fn(),
      categoryDialogOpen: true,
    };
    const { rerender } = render(
      <LedgerEntriesBatchActionToolbar
        {...props}
        pickedCategoryIds={["category-1", "category-2"]}
      />
    );

    expect(screen.getByText(/AI 将把 5 条明细归入这 2 个分类/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 分类 5 条明细" })).toBeEnabled();

    rerender(
      <LedgerEntriesBatchActionToolbar
        {...props}
        pickedCategoryIds={categories.map((category) => category.id)}
      />
    );

    expect(screen.getByText(/AI 将把 5 条明细归入这 13 个分类/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AI 分类 5 条明细" })).toBeEnabled();
  });

  it("makes the clear row a pick of its own, against every category", () => {
    const onToggleCategoryPick = vi.fn();
    renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onChangeCategory: vi.fn(),
      onConfirmCategory: vi.fn(),
      onToggleCategoryPick,
      categoryDialogOpen: true,
      clearCategoryPicked: true,
    });

    expect(screen.getByRole("button", { name: "清空 5 条分类" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /餐饮/ }));
    expect(onToggleCategoryPick).toHaveBeenCalledWith("category-1", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "清空分类" }));
    expect(onToggleCategoryPick).toHaveBeenCalledWith(null, false);
  });

  it("confirms the pick the summary promises", () => {
    const onConfirmCategory = vi.fn();
    renderToolbar({
      selectedCount: 5,
      categories: [dining],
      onChangeCategory: vi.fn(),
      onConfirmCategory,
      onToggleCategoryPick: vi.fn(),
      categoryDialogOpen: true,
      pickedCategoryIds: ["category-1"],
    });

    fireEvent.click(screen.getByRole("button", { name: "设为「餐饮」" }));

    expect(onConfirmCategory).toHaveBeenCalledOnce();
  });

  describe("dock layout", () => {
    it("drops the selection bar and offers the actions as a labelled toolbar", () => {
      renderToolbar({
        layout: "dock",
        selectedCount: 2,
        onChangeDate: vi.fn(),
        onRetry: vi.fn(),
        onDelete: vi.fn(),
      });

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
      const dock = screen.getByRole("toolbar", { name: "批量操作" });
      expect(
        within(dock)
          .getAllByRole("button")
          .map((button) => button.textContent)
      ).toEqual(["日期", "重试", "删除"]);
    });

    it("keeps every action a finger tall and marks delete as dangerous", () => {
      renderToolbar({ layout: "dock", selectedCount: 1, onChangeDate: vi.fn(), onDelete: vi.fn() });

      for (const button of within(screen.getByRole("toolbar")).getAllByRole("button")) {
        expect(button).toHaveClass("min-h-11");
      }
      expect(screen.getByRole("button", { name: "删除" })).toHaveClass("text-danger");
    });

    it("runs an action and disables all of them while nothing is selected", () => {
      const onDelete = vi.fn();
      const { rerender, props } = renderToolbar({ layout: "dock", selectedCount: 0, onDelete });
      expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();

      rerender(
        <LedgerEntriesBatchActionToolbar
          {...props}
          selectedCount={1}
          onDelete={onDelete}
          layout="dock"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      expect(onDelete).toHaveBeenCalledOnce();
    });

    it("says the 100-row limit in one line above the actions", () => {
      renderToolbar({
        layout: "dock",
        selectedCount: 101,
        onChangeDate: vi.fn(),
        onDelete: vi.fn(),
      });

      expect(screen.getByText("日期、删除每次最多处理 100 条。")).toBeInTheDocument();
    });

    it("renders nothing for a surface with no actions", () => {
      renderToolbar({ layout: "dock", selectedCount: 1 });

      expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    });
  });
});
