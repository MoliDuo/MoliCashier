import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Period } from "@/modules/ledger/domain/period";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";
import { LedgerEntriesToolbar } from "@/modules/workspace/ui/LedgerEntriesToolbar";

const defaultPeriod: Period = { range: "month", offset: 0 };

const defaultProps = {
  isSelectionMode: false,
  isAllSelected: false,
  selectedCount: 0,
  loadedCount: 5,
  onToggleSelectionMode: vi.fn(),
  onSelectAll: vi.fn(),
  onClearSelection: vi.fn(),
  filters: {} as const,
  onFiltersChange: vi.fn(),
  categories: [],
  preferredCurrencies: [],
  period: defaultPeriod,
  today: "2026-09-27",
  onPeriodChange: vi.fn(),
  mainCurrency: "CNY",
  filteredTotal: "123.45",
};

describe("LedgerEntriesToolbar", () => {
  it("names the period beside its total", () => {
    render(<LedgerEntriesToolbar {...defaultProps} />);

    expect(screen.getByRole("button", { name: "区间：2026年9月" })).toBeInTheDocument();
    expect(screen.getByText("¥123.45")).toBeInTheDocument();
  });

  it("steps to either side of this month, up to a year ahead", () => {
    const onPeriodChange = vi.fn();
    const { rerender } = render(
      <LedgerEntriesToolbar {...defaultProps} onPeriodChange={onPeriodChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: "上一期" }));
    expect(onPeriodChange).toHaveBeenCalledWith({ range: "month", offset: -1 });
    fireEvent.click(screen.getByRole("button", { name: "下一期" }));
    expect(onPeriodChange).toHaveBeenCalledWith({ range: "month", offset: 1 });

    rerender(
      <LedgerEntriesToolbar
        {...defaultProps}
        period={{ range: "month", offset: 12 }}
        onPeriodChange={onPeriodChange}
      />
    );
    expect(screen.getByRole("button", { name: "下一期" })).toBeDisabled();
  });

  it("prints both days of a named range", () => {
    render(
      <LedgerEntriesToolbar
        {...defaultProps}
        period={{ range: "custom", from: "2026-09-01", to: "2026-09-10" }}
      />
    );

    expect(screen.getByText("2026年9月1日 – 9月10日")).toBeInTheDocument();
  });

  it("shows selection controls instead of totals and filters while selecting", () => {
    render(<LedgerEntriesToolbar {...defaultProps} isSelectionMode={true} selectedCount={3} />);

    expect(screen.getByRole("checkbox", { name: "全选" })).toBeInTheDocument();
    expect(screen.getByText(/^已选 3 \/ (已加载 )?5$/)).toBeInTheDocument();
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
    expect(screen.getByTitle("取消")).toBeInTheDocument();
    expect(screen.queryByText("¥123.45")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选" })).not.toBeInTheDocument();
  });

  it("names only the stream's own actions in the 100-row note", () => {
    render(
      <LedgerEntriesToolbar
        {...defaultProps}
        isSelectionMode={true}
        selectedCount={101}
        loadedCount={120}
        onUpdateDates={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("日期、删除每次最多处理 100 条。")).toBeInTheDocument();
    expect(screen.queryByText(/分类/)).not.toBeInTheDocument();
    expect(screen.queryByText(/币种/)).not.toBeInTheDocument();
  });

  it("offers select all before anything is selected", () => {
    render(<LedgerEntriesToolbar {...defaultProps} isSelectionMode={true} selectedCount={0} />);

    const master = screen.getByRole("checkbox");
    expect(master).toBeEnabled();

    fireEvent.click(master);
    expect(defaultProps.onSelectAll).toHaveBeenCalled();
  });

  it("keeps active status details inside the filter panel", () => {
    render(<LedgerEntriesToolbar {...defaultProps} filters={{ statuses: ["completed"] }} />);

    expect(screen.queryByText(/状态：/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已启用 1 个筛选" })).toBeInTheDocument();
  });

  it("renders the amount without a redundant label when the prefix is gone", () => {
    render(<LedgerEntriesToolbar {...defaultProps} />);

    expect(screen.getByText("¥123.45")).toBeInTheDocument();
    expect(screen.queryByText(/Filtered total/i)).not.toBeInTheDocument();
  });

  it("asks for the date and the impact in one dialog", async () => {
    const onUpdateDates = vi.fn();
    let answerPreview: (impact: BatchEntryDateImpact) => void = () => {};
    const onPreviewDateImpact = vi.fn(
      () =>
        new Promise<BatchEntryDateImpact>((resolve) => {
          answerPreview = resolve;
        })
    );
    render(
      <LedgerEntriesToolbar
        {...defaultProps}
        isSelectionMode
        selectedCount={1}
        selectedSourceDocumentIds={["document-1"]}
        selectedEntryIds={["entry-1"]}
        onUpdateDates={onUpdateDates}
        onPreviewDateImpact={onPreviewDateImpact}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /修改日期/ }));

    // The dialog is up before the preview answers, and fills in behind it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    answerPreview({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 1,
      sourceDocumentIds: ["document-1"],
    });

    await waitFor(() => expect(onPreviewDateImpact).toHaveBeenCalledOnce());
    expect(await screen.findByText(/将影响 1 张账单和 1 条明细/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(onUpdateDates).toHaveBeenCalledWith(expect.any(String), ["document-1"])
    );
  });

  describe("on a phone", () => {
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

    beforeEach(() => {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn((query: string) => ({
          matches: true,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
    });

    afterEach(() => {
      if (originalMatchMedia != null) {
        Object.defineProperty(window, "matchMedia", originalMatchMedia);
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
    });

    it("moves the actions to the action bar and leaves the count to the top bar", () => {
      render(
        <LedgerEntriesToolbar
          {...defaultProps}
          isSelectionMode={true}
          selectedCount={3}
          onUpdateDates={vi.fn()}
          onRetry={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByRole("toolbar", { name: "批量操作" })).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "全选" })).not.toBeInTheDocument();
      expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    });

    it("keeps the select toggle out of the drop-down", () => {
      render(<LedgerEntriesToolbar {...defaultProps} />);

      expect(screen.getByRole("button", { name: "选择" })).toHaveClass("max-md:hidden");
    });
  });
});
