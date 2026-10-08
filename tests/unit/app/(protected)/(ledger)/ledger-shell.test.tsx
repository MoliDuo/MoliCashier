import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { activeTabState, navigateMock, routerPrefetchMock, prefetchStatsTabQueryMock } = vi.hoisted(
  () => ({
    activeTabState: { current: "records" as string },
    navigateMock: vi.fn(),
    routerPrefetchMock: vi.fn(),
    prefetchStatsTabQueryMock: vi.fn(),
  })
);

vi.mock("@/modules/workspace/hooks/useLedgerNavigation", () => ({
  useLedgerNavigation: () => ({
    activeTab: activeTabState.current,
    hrefFor: (tab: string) => `/${tab}`,
    navigate: navigateMock,
    prefetch: routerPrefetchMock,
  }),
}));

vi.mock("@/modules/workspace/hooks/useTabScrollRestoration", () => ({
  useTabScrollRestoration: () => {},
}));

vi.mock("@/modules/workspace/ui/AppShell", () => ({
  AppShell: ({
    children,
    topBar,
    bottomBar,
  }: {
    children: ReactNode;
    topBar: ReactNode;
    bottomBar: ReactNode;
  }) => (
    <>
      <div data-testid="top-bar">{topBar}</div>
      <div data-testid="bottom-bar">{bottomBar}</div>
      {children}
    </>
  ),
}));

vi.mock("@/modules/workspace/ui/BookSwitcher", () => ({ BookSwitcher: () => null }));

vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({ preloadNewRecordModules: vi.fn() }));

vi.mock("@/modules/workspace/prefetch-ledger-tabs", () => ({
  prefetchDetailsTabQuery: vi.fn(),
  prefetchStatsTabQuery: prefetchStatsTabQueryMock,
}));

import { LedgerShell } from "@/app/(protected)/(ledger)/_shell";
import { EntriesToolbarShell } from "@/modules/workspace/ui/EntriesToolbarShell";
import { ledgerPageCopy } from "@/copy/app";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";
import type { Period } from "@/modules/ledger/domain/period";
import {
  WorkspaceStoreProvider,
  useHeaderSelection,
  useWorkspaceStore,
} from "@/modules/workspace/store";

const BOOK_ID = "10000000-0000-4000-8000-000000000001";

/**
 * Stands in for the route: it holds the route's query, and it marks the
 * workspace ready, which the shell waits on before it enables its destinations.
 */
function RouteContent({
  queryKey,
  queryFn,
}: {
  queryKey: string[];
  queryFn: () => Promise<string>;
}) {
  const setReady = useWorkspaceStore((state) => state.setReady);
  useEffect(() => setReady(true), [setReady]);
  useQuery({ queryKey, queryFn });
  return null;
}

/** A book switch is a store update with no server render behind it. */
function BookSwitch() {
  const setBookId = useWorkspaceStore((state) => state.setBookId);
  return (
    <button type="button" onClick={() => setBookId(BOOK_ID)}>
      switch-book
    </button>
  );
}

function renderShell(
  queryKey: string[] = ["ledger", "source-documents", "stream"],
  queryFn: () => Promise<string> = vi.fn().mockResolvedValue("stream")
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceStoreProvider initialBookId={null}>
        <BookSwitch />
        <LedgerShell>
          <RouteContent queryKey={queryKey} queryFn={queryFn} />
        </LedgerShell>
      </WorkspaceStoreProvider>
    </QueryClientProvider>
  );
}

/** A tab on the phone's bottom bar; the desktop top bar carries the same four. */
function destination(tab: LedgerTab) {
  return within(screen.getByTestId("bottom-bar")).getByRole("button", {
    name: ledgerPageCopy[tab],
  });
}

/** A list's toolbar as 账目 renders it: browsed, or selected from. */
function BrowsedList({
  filtered = false,
  selecting = false,
  period = { range: "month", offset: 0 },
  onPeriodChange = () => {},
}: {
  filtered?: boolean;
  selecting?: boolean;
  period?: Period;
  onPeriodChange?: (period: Period) => void;
}) {
  return (
    <EntriesToolbarShell
      totalLabel={selecting ? undefined : "¥10,800.33"}
      browsing={selecting ? undefined : { period: "2026年9月", filtered }}
      periodControl={{ period, today: "2026-09-27", onChange: onPeriodChange }}
    >
      {null}
    </EntriesToolbarShell>
  );
}

/** Marks the ledger's content mounted, which enables the bars. */
function ReadyContent() {
  const setReady = useWorkspaceStore((state) => state.setReady);
  useEffect(() => setReady(true), [setReady]);
  return null;
}

/** A list that can be selected from, as 账目 and 明细 publish themselves. */
function SelectableList({
  active,
  onToggle = () => {},
  onToggleAll = () => {},
}: {
  active: boolean;
  onToggle?: () => void;
  onToggleAll?: () => void;
}) {
  const setReady = useWorkspaceStore((state) => state.setReady);
  useEffect(() => setReady(true), [setReady]);
  useHeaderSelection({
    active,
    disabled: false,
    selectedCount: 2,
    loadedCount: 5,
    hasMore: false,
    allSelected: "indeterminate",
    onToggle,
    onToggleAll,
  });
  return null;
}

describe("LedgerShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeTabState.current = "records";
  });

  it("refreshes the tab the reader is on instead of navigating to it", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("records")).toBeEnabled());
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));

    await user.click(destination("records"));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(destination("records")).not.toHaveAttribute("aria-busy"));
  });

  it("navigates when the destination is another tab", async () => {
    const user = userEvent.setup();
    const stream = vi.fn().mockResolvedValue("stream");
    renderShell(["ledger", "source-documents", "stream"], stream);
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(destination("stats"));

    expect(navigateMock).toHaveBeenCalledWith("stats");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("prefetches a hovered route for the book being viewed now", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.click(screen.getByRole("button", { name: "switch-book" }));
    await user.hover(destination("stats"));

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[1]).toBe(BOOK_ID);
    expect(routerPrefetchMock).toHaveBeenCalledWith("/stats");
  });

  it("prefetches 总账 with no book when none is viewed", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(destination("stats")).toBeEnabled());

    await user.hover(destination("stats"));

    await waitFor(() => expect(prefetchStatsTabQueryMock).toHaveBeenCalled());
    expect(prefetchStatsTabQueryMock.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it("opens 明细 and 设置 like any other tab", async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(destination("entries")).toBeEnabled());

    await user.click(destination("entries"));
    expect(navigateMock).toHaveBeenLastCalledWith("entries");

    await user.click(destination("settings"));
    expect(navigateMock).toHaveBeenLastCalledWith("settings");
  });

  it("has no gear and no back arrow in the top bar", () => {
    activeTabState.current = "settings";
    renderShell();
    const topBar = within(screen.getByTestId("top-bar"));

    expect(topBar.queryByRole("link", { name: "设置" })).not.toBeInTheDocument();
    expect(topBar.queryByRole("button", { name: "返回" })).not.toBeInTheDocument();
    expect(topBar.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });

  it("warms every other route once the ledger is up", async () => {
    renderShell();

    await waitFor(() => expect(routerPrefetchMock).toHaveBeenCalledWith("/stats"));
    expect(routerPrefetchMock).toHaveBeenCalledWith("/entries");
    expect(routerPrefetchMock).toHaveBeenCalledWith("/settings");
    expect(routerPrefetchMock).not.toHaveBeenCalledWith("/records");
  });

  it("prints the list's summary in the top bar while the list is browsed", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderWith = (list: ReactNode) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>{list}</LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(renderWith(<BrowsedList />));
    const topBar = within(screen.getByTestId("top-bar"));

    expect(topBar.getByText("¥10,800.33")).toBeInTheDocument();
    expect(topBar.getByText("2026年9月")).toBeInTheDocument();

    rerender(renderWith(<BrowsedList filtered />));
    expect(topBar.getByText(`2026年9月 · ${ledgerPageCopy.filtered}`)).toBeInTheDocument();

    // Selecting keeps its bar on the page, so the summary steps aside.
    rerender(renderWith(<BrowsedList selecting />));
    expect(topBar.queryByText("¥10,800.33")).not.toBeInTheDocument();

    rerender(renderWith(null));
    expect(topBar.queryByText("¥10,800.33")).not.toBeInTheDocument();
  });

  it("drops the list's controls down from the summary and folds them again", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <BrowsedList />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const summary = within(screen.getByTestId("top-bar")).getByRole("button", {
      name: /¥10,800\.33/,
    });
    const toolbar = screen.getByTestId("entries-toolbar");
    expect(summary).toHaveAttribute("aria-controls", toolbar.id);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(toolbar).toHaveClass("max-md:hidden");

    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(toolbar).not.toHaveClass("max-md:hidden");
    expect(toolbar).toHaveClass("max-md:fixed");

    await user.keyboard("{Escape}");
    expect(summary).toHaveAttribute("aria-expanded", "false");

    await user.click(summary);
    await user.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("steps the period from the arrows beside the summary", async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderWith = (period: Period) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <ReadyContent />
            <BrowsedList period={period} onPeriodChange={onPeriodChange} />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(renderWith({ range: "month", offset: -1 }));
    const topBar = within(screen.getByTestId("top-bar"));

    await user.click(topBar.getByRole("button", { name: "上一期" }));
    await user.click(topBar.getByRole("button", { name: "下一期" }));
    expect(onPeriodChange.mock.calls).toEqual([
      [{ range: "month", offset: -2 }],
      [{ range: "month", offset: 0 }],
    ]);

    // A year ahead is as far forward as a period goes.
    rerender(renderWith({ range: "month", offset: 0 }));
    expect(topBar.getByRole("button", { name: "下一期" })).toBeEnabled();
    rerender(renderWith({ range: "month", offset: 12 }));
    expect(topBar.getByRole("button", { name: "下一期" })).toBeDisabled();
    expect(topBar.getByRole("button", { name: "上一期" })).toBeEnabled();

    // 全部 has nothing to step through.
    rerender(renderWith({ range: "all" }));
    expect(topBar.queryByRole("button", { name: "上一期" })).not.toBeInTheDocument();
  });

  it("picks a period from the dropped controls and folds them", async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <BrowsedList onPeriodChange={onPeriodChange} />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const summary = within(screen.getByTestId("top-bar")).getByRole("button", {
      name: /¥10,800\.33/,
    });
    const toolbar = within(screen.getByTestId("entries-toolbar"));
    expect(toolbar.queryByRole("button", { name: "2026年6月" })).not.toBeInTheDocument();

    await user.click(summary);
    await user.click(toolbar.getByRole("button", { name: "2026年6月" }));

    expect(onPeriodChange).toHaveBeenCalledWith({ range: "month", offset: -3 });
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("leaves the summary out of 设置's bar", () => {
    activeTabState.current = "settings";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <BrowsedList />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );

    expect(within(screen.getByTestId("top-bar")).queryByText("¥10,800.33")).not.toBeInTheDocument();
  });

  it("turns a phone's bars over to selecting while a list is selected from", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderWith = (active: boolean) => (
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>
            <SelectableList active={active} onToggle={onToggle} onToggleAll={onToggleAll} />
          </LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(renderWith(false));
    const topBar = within(screen.getByTestId("top-bar"));
    const bottomBar = screen.getByTestId("bottom-bar");

    // Browsing: the select toggle is on the left and the tabs are on the bottom.
    expect(topBar.getByRole("button", { name: "选择" })).toBeInTheDocument();
    expect(topBar.queryByText(/已选/)).not.toBeInTheDocument();
    expect(within(bottomBar).getByRole("button", { name: "账目" })).toBeInTheDocument();

    rerender(renderWith(true));
    expect(topBar.getByText("已选 2 / 5")).toBeInTheDocument();
    expect(within(bottomBar).queryByRole("button")).not.toBeInTheDocument();

    await user.click(topBar.getByRole("checkbox", { name: "全选" }));
    expect(onToggleAll).toHaveBeenCalledOnce();

    await user.click(topBar.getByRole("button", { name: "取消" }));
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(renderWith(false));
    expect(within(bottomBar).getByRole("button", { name: "账目" })).toBeInTheDocument();
  });

  it("offers no select toggle on 统计 or 设置", () => {
    activeTabState.current = "stats";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceStoreProvider initialBookId={null}>
          <LedgerShell>{null}</LedgerShell>
        </WorkspaceStoreProvider>
      </QueryClientProvider>
    );

    expect(
      within(screen.getByTestId("top-bar")).queryByRole("button", { name: "选择" })
    ).not.toBeInTheDocument();
  });
});
