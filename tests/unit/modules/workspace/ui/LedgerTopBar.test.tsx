import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LedgerTab } from "@/lib/ledger-tabs";
import {
  WorkspaceStoreProvider,
  useWorkspaceStore,
  type HeaderSelection,
  type HeaderSummary,
} from "@/modules/workspace/store";

vi.mock("@/modules/workspace/ui/BookSwitcher", () => ({
  BookSwitcher: () => <div data-testid="book-switcher" />,
}));

import { LedgerTopBar } from "@/modules/workspace/ui/LedgerTopBar";

const summary: HeaderSummary = {
  total: "¥12.00",
  period: "本月",
  filtered: false,
  steps: { back: true, forward: false },
  onStep: vi.fn(),
};

const selection = (active: boolean): HeaderSelection => ({
  active,
  disabled: false,
  selectedCount: 2,
  loadedCount: 5,
  hasMore: false,
  allSelected: false,
  onToggle: vi.fn(),
  onToggleAll: vi.fn(),
});

function Seed({ withSelection }: { withSelection: HeaderSelection | null }) {
  const setHeaderSummary = useWorkspaceStore((state) => state.setHeaderSummary);
  const setHeaderSelection = useWorkspaceStore((state) => state.setHeaderSelection);
  useEffect(() => {
    setHeaderSummary(summary);
    setHeaderSelection(withSelection);
  }, [setHeaderSummary, setHeaderSelection, withSelection]);
  return null;
}

function renderBar(activeTab: LedgerTab, withSelection: HeaderSelection | null = null) {
  return render(
    <WorkspaceStoreProvider initialBookId={null}>
      <Seed withSelection={withSelection} />
      <LedgerTopBar
        activeTab={activeTab}
        disabled={false}
        navigation={null}
        onOpenInput={vi.fn()}
        onInputIntent={vi.fn()}
      />
    </WorkspaceStoreProvider>
  );
}

/** Whether `a` comes before `b` in the document, which is left to right in the bar. */
function before(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("LedgerTopBar", () => {
  it("puts the one book switcher on the left, before the summary and the select toggle", () => {
    renderBar("records", selection(false));

    const switchers = screen.getAllByTestId("book-switcher");
    expect(switchers).toHaveLength(1);
    const summaryButton = screen.getByRole("button", { name: /本月/ });
    const selectToggle = screen.getByRole("button", { name: "选择" });
    expect(before(switchers[0]!, summaryButton)).toBe(true);
    expect(before(summaryButton, selectToggle)).toBe(true);
  });

  it("moves select-all to the left and cancel to the right while selecting", () => {
    renderBar("records", selection(true));

    const selectAll = screen.getByRole("checkbox");
    const count = screen.getByText(/2/, { selector: "p" });
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(before(selectAll, count)).toBe(true);
    expect(before(count, cancel)).toBe(true);
  });

  it("has no book switcher in 设置, only its name", () => {
    renderBar("settings");

    expect(screen.queryByTestId("book-switcher")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });
});
