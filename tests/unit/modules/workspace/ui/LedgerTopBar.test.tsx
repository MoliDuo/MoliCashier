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
  it("puts the select toggle on the left, the summary in the middle and the switcher on the right", () => {
    renderBar("records", selection(false));

    // One switcher for the desktop bar and one for the phone's; the phone's is last.
    const switchers = screen.getAllByTestId("book-switcher");
    expect(switchers).toHaveLength(2);
    const phoneSwitcher = switchers[1]!;
    expect(phoneSwitcher.parentElement).toHaveClass("md:hidden");
    const selectToggle = screen.getByRole("button", { name: "选择" });
    const summaryButton = screen.getByRole("button", { name: /本月/ });
    expect(before(selectToggle, summaryButton)).toBe(true);
    expect(before(summaryButton, phoneSwitcher)).toBe(true);
  });

  it("keeps cancel on the left, the count in the middle and select-all on the right while selecting", () => {
    renderBar("records", selection(true));

    const cancel = screen.getByRole("button", { name: "取消" });
    const count = screen.getByText(/2/, { selector: "p" });
    const selectAll = screen.getByRole("checkbox");
    expect(before(cancel, count)).toBe(true);
    expect(before(count, selectAll)).toBe(true);
    // The phone's switcher steps aside for select-all.
    expect(screen.getAllByTestId("book-switcher")[1]!.parentElement).toHaveClass("max-md:hidden");
  });

  it("has no book switcher in 设置, only its name", () => {
    renderBar("settings");

    expect(screen.queryByTestId("book-switcher")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });
});
