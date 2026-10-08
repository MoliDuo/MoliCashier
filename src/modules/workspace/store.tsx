"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { LEDGER_PERIOD_TABS, type LedgerTab } from "@/modules/workspace/ledger-tabs";

interface WorkspaceState {
  /** False until the ledger's content has mounted; the navigation waits for it. */
  ready: boolean;
  setReady: (ready: boolean) => void;
  /**
   * The book the reader picked, or null for 总账. It is this device's choice,
   * remembered by a cookie, not URL state — so it survives moving between routes.
   */
  bookId: string | null;
  setBookId: (bookId: string | null) => void;
  /** Each route's last query, so returning to a tab returns to its filters. */
  routeQueries: Partial<Record<LedgerTab, string>>;
  rememberRouteQuery: (tab: LedgerTab, query: string) => void;
  /**
   * The last route that showed a period. 设置 has none, so a tab opened from
   * there takes the period from this route's remembered query.
   */
  lastPeriodTab: LedgerTab | null;
  /**
   * The list on screen as a phone's top bar prints it in the middle, or null
   * when no list is being browsed. Taking it down also folds the
   * list's controls back up.
   */
  headerSummary: HeaderSummary | null;
  setHeaderSummary: (summary: HeaderSummary | null) => void;
  /** Whether a phone's list controls hang open under the top bar. */
  listControlsOpen: boolean;
  setListControlsOpen: (open: boolean) => void;
  /**
   * The list's selection as a phone's top bar shows it: a toggle on the left
   * and, while selecting, the count and 全选. Null on routes with nothing to
   * select.
   */
  headerSelection: HeaderSelection | null;
  setHeaderSelection: (selection: HeaderSelection | null) => void;
}

export interface HeaderSelection {
  /** Whether the list is being selected from. */
  active: boolean;
  disabled: boolean;
  selectedCount: number;
  loadedCount: number;
  /** Whether more of the list is still to load, so the count reads "已加载". */
  hasMore: boolean;
  allSelected: boolean | "indeterminate";
  /** Enters or leaves selecting. */
  onToggle: () => void;
  /** Selects everything loaded, or clears when it all is selected. */
  onToggleAll: () => void;
}

export interface HeaderSummary {
  /** The list's total, or null until it has loaded. */
  total: string | null;
  /** The days the list covers. */
  period: string;
  /** Whether the filter narrows the list beyond the period. */
  filtered: boolean;
  /**
   * Which ways the top bar's arrows can step the period, or null when it does
   * not step (全部, or two named days).
   */
  steps: { back: boolean; forward: boolean } | null;
  /** Steps the period one back (-1) or forward (1). */
  onStep: (by: -1 | 1) => void;
}

function sameSummary(a: HeaderSummary | null, b: HeaderSummary | null): boolean {
  if (a == null || b == null) return a === b;
  const sameSteps =
    a.steps == null || b.steps == null
      ? a.steps === b.steps
      : a.steps.back === b.steps.back && a.steps.forward === b.steps.forward;
  return (
    a.total === b.total &&
    a.period === b.period &&
    a.filtered === b.filtered &&
    sameSteps &&
    a.onStep === b.onStep
  );
}

function sameSelection(a: HeaderSelection | null, b: HeaderSelection | null): boolean {
  if (a == null || b == null) return a === b;
  return (
    a.active === b.active &&
    a.disabled === b.disabled &&
    a.selectedCount === b.selectedCount &&
    a.loadedCount === b.loadedCount &&
    a.hasMore === b.hasMore &&
    a.allSelected === b.allSelected &&
    a.onToggle === b.onToggle &&
    a.onToggleAll === b.onToggleAll
  );
}

type WorkspaceStore = StoreApi<WorkspaceState>;

function createWorkspaceStore(initialBookId: string | null): WorkspaceStore {
  return createStore<WorkspaceState>((set) => ({
    ready: false,
    setReady: (ready) => set({ ready }),
    bookId: initialBookId,
    setBookId: (bookId) => set((state) => (state.bookId === bookId ? state : { bookId })),
    routeQueries: {},
    lastPeriodTab: null,
    rememberRouteQuery: (tab, query) =>
      set((state) => {
        const lastPeriodTab = LEDGER_PERIOD_TABS.has(tab) ? tab : state.lastPeriodTab;
        if (state.routeQueries[tab] === query && state.lastPeriodTab === lastPeriodTab) {
          return state;
        }
        return { routeQueries: { ...state.routeQueries, [tab]: query }, lastPeriodTab };
      }),
    headerSummary: null,
    setHeaderSummary: (headerSummary) =>
      set((state) => {
        if (sameSummary(state.headerSummary, headerSummary)) return state;
        return headerSummary == null
          ? { headerSummary, listControlsOpen: false }
          : { headerSummary };
      }),
    listControlsOpen: false,
    setListControlsOpen: (listControlsOpen) =>
      set((state) =>
        state.listControlsOpen === listControlsOpen ||
        (listControlsOpen && state.headerSummary == null)
          ? state
          : { listControlsOpen }
      ),
    headerSelection: null,
    setHeaderSelection: (headerSelection) =>
      set((state) =>
        sameSelection(state.headerSelection, headerSelection) ? state : { headerSelection }
      ),
  }));
}

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

/**
 * The state the ledger's routes share. One store per layout instance rather
 * than a module singleton, so the server render and the hydrating client start
 * from the same book — the one the request's cookie named.
 */
export function WorkspaceStoreProvider({
  initialBookId,
  children,
}: {
  initialBookId: string | null;
  children: ReactNode;
}) {
  const [store] = useState(() => createWorkspaceStore(initialBookId));
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>;
}

export function useWorkspaceStore<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext);
  if (store == null)
    throw new Error("useWorkspaceStore must be used within WorkspaceStoreProvider");
  return useStore(store, selector);
}

/**
 * Puts a list's summary in the top bar for as long as the list is browsed, and
 * takes it down when the list leaves or turns to selecting; returns whether a
 * phone has its controls dropped down, and how to fold them. Outside the
 * ledger's routes there is no top bar, so there the controls stay put. The step
 * command is read through a ref, so a page's inline closure does not churn the
 * store.
 */
export function useHeaderSummary(summary: HeaderSummary | null): {
  open: boolean;
  close: () => void;
} {
  const store = useContext(WorkspaceStoreContext);
  const total = summary?.total ?? null;
  const period = summary?.period;
  const filtered = summary?.filtered ?? false;
  const back = summary?.steps?.back;
  const forward = summary?.steps?.forward;
  const step = useRef(summary?.onStep);
  const latestStep = summary?.onStep;
  useLayoutEffect(() => {
    step.current = latestStep;
  }, [latestStep]);
  const [onStep] = useState(() => (by: -1 | 1) => step.current?.(by));
  useEffect(() => {
    if (store == null) return;
    store.getState().setHeaderSummary(
      period == null
        ? null
        : {
            total,
            period,
            filtered,
            steps: back == null || forward == null ? null : { back, forward },
            onStep,
          }
    );
  }, [store, total, period, filtered, back, forward, onStep]);
  useEffect(() => {
    if (store == null) return;
    return () => store.getState().setHeaderSummary(null);
  }, [store]);
  const open = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getState().listControlsOpen ?? false,
    () => false
  );
  const close = useCallback(() => store?.getState().setListControlsOpen(false), [store]);
  return { open, close };
}

const noSubscription = () => () => {};

/**
 * Puts a list's selection in the top bar for as long as the list is on screen;
 * takes it down when the list leaves. The two commands are read through a ref,
 * so a page's inline closures do not churn the store. It is published in a
 * layout effect so a phone's tab bar is already gone when the action bar
 * appears, rather than showing under it for a frame.
 */
export function useHeaderSelection(
  selection: Omit<HeaderSelection, "onToggle" | "onToggleAll"> & {
    onToggle: () => void;
    onToggleAll: () => void;
  }
): void {
  const store = useContext(WorkspaceStoreContext);
  const commands = useRef({ onToggle: selection.onToggle, onToggleAll: selection.onToggleAll });
  const { onToggle, onToggleAll } = selection;
  useLayoutEffect(() => {
    commands.current = { onToggle, onToggleAll };
  }, [onToggle, onToggleAll]);
  const [stable] = useState(() => ({
    onToggle: () => commands.current.onToggle(),
    onToggleAll: () => commands.current.onToggleAll(),
  }));
  const { active, disabled, selectedCount, loadedCount, hasMore, allSelected } = selection;
  useLayoutEffect(() => {
    if (store == null) return;
    store.getState().setHeaderSelection({
      active,
      disabled,
      selectedCount,
      loadedCount,
      hasMore,
      allSelected,
      ...stable,
    });
  }, [store, stable, active, disabled, selectedCount, loadedCount, hasMore, allSelected]);
  useLayoutEffect(() => {
    if (store == null) return;
    return () => store.getState().setHeaderSelection(null);
  }, [store]);
}
