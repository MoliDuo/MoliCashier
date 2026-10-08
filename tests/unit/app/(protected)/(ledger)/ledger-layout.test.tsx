import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const {
  loadLedgerViewMock,
  getLedgerBooksBootstrapMock,
  getLedgerShellBootstrapMock,
  getLedgerRouteBootstrapMock,
  requestHeaders,
} = vi.hoisted(() => ({
  loadLedgerViewMock: vi.fn(),
  getLedgerBooksBootstrapMock: vi.fn(),
  getLedgerShellBootstrapMock: vi.fn(),
  getLedgerRouteBootstrapMock: vi.fn(),
  requestHeaders: { current: new Headers() },
}));

vi.mock("@/modules/workspace/server/ledger-page-bootstrap", () => ({
  loadLedgerView: loadLedgerViewMock,
  getLedgerBooksBootstrap: getLedgerBooksBootstrapMock,
  getLedgerShellBootstrap: getLedgerShellBootstrapMock,
  getLedgerRouteBootstrap: getLedgerRouteBootstrapMock,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

// The client tree is never mounted here — the assertions read the props the
// server components hand it — so the real client components would only drag
// their hook graphs into the test.
vi.mock("@/modules/workspace/store", () => ({
  WorkspaceStoreProvider: (props: { children: React.ReactNode }) => props.children,
}));
vi.mock("@/modules/workspace/ui/LedgerWorkspace", () => ({
  LedgerWorkspace: (props: { children: React.ReactNode }) => props.children,
}));
vi.mock("@/app/(protected)/(ledger)/_shell", () => ({
  LedgerShell: (props: { children: React.ReactNode }) => props.children,
}));
vi.mock("@/app/(protected)/(ledger)/_route-fallback", () => ({
  LedgerRouteFallback: () => null,
}));

import { HydrationBoundary } from "@tanstack/react-query";
import LedgerLayout from "@/app/(protected)/(ledger)/layout";
import { LedgerShell } from "@/app/(protected)/(ledger)/_shell";
import { RoutePrefetch } from "@/app/(protected)/(ledger)/_route-prefetch";
import { WorkspaceStoreProvider } from "@/modules/workspace/store";
import { LedgerWorkspace } from "@/modules/workspace/ui/LedgerWorkspace";
import { UnauthorizedError } from "@/lib/errors";
import { must } from "tests/helpers/must";

const BOOK_B = "20000000-0000-4000-8000-00000000000b";

type AnyElement = React.ReactElement<Record<string, unknown>>;

/** Every element in a server-rendered tree, depth first. */
function elements(node: unknown): AnyElement[] {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  const element = node as AnyElement;
  if (!React.isValidElement(element)) return [];
  return [element, ...elements(element.props.children)];
}

function find(node: unknown, type: unknown): AnyElement {
  const match = elements(node).find((element) => element.type === type);
  if (match == null) throw new Error("element not found");
  return match;
}

/** Renders the layout's inner async component, the one inside its Suspense. */
async function renderShellData(tree: unknown) {
  const data = elements(tree).find((element) => "view" in element.props);
  if (data == null) throw new Error("shell data not found");
  const render = data.type as (props: Record<string, unknown>) => Promise<unknown>;
  return render(data.props);
}

const view = {
  context: { ledgerDto: {} },
  books: [],
  categories: Promise.resolve([]),
  rememberedBookId: BOOK_B,
  bookId: BOOK_B,
  ledgerToday: "2026-09-26",
};

const booksState = { queries: [{ queryKey: ["ledger", "books"] }], mutations: [] };

describe("ledger layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadLedgerViewMock.mockResolvedValue(view);
    getLedgerBooksBootstrapMock.mockReturnValue(booksState);
    getLedgerShellBootstrapMock.mockResolvedValue({ queries: [], mutations: [] });
  });

  it("starts the store on the book the request resolved", async () => {
    const tree = await LedgerLayout({ children: null });

    expect(find(tree, WorkspaceStoreProvider).props.initialBookId).toBe(BOOK_B);
  });

  it("hydrates the books above the bars, whose book switcher reads them first", async () => {
    const tree = await LedgerLayout({ children: null });

    expect(getLedgerBooksBootstrapMock).toHaveBeenCalledWith(view.books);
    const boundary = must(
      elements(tree).find(
        (element) => element.type === HydrationBoundary && element.props.state === booksState
      ),
      "books hydration boundary"
    );
    expect(find(boundary.props.children, LedgerShell).type).toBe(LedgerShell);
  });

  it("hands the workspace today in the ledger's zone", async () => {
    const data = await renderShellData(await LedgerLayout({ children: null }));

    expect(find(data, LedgerWorkspace).props).toMatchObject({ ledgerToday: "2026-09-26" });
  });

  it("still renders the workspace when the shell bootstrap fails", async () => {
    getLedgerShellBootstrapMock.mockRejectedValue(new Error("categories are down"));

    const data = await renderShellData(await LedgerLayout({ children: null }));

    expect(find(data, LedgerWorkspace).props).toMatchObject({ ledgerToday: "2026-09-26" });
  });

  it("sends a request without a session straight to the sign-in route", async () => {
    loadLedgerViewMock.mockRejectedValue(new UnauthorizedError());

    await expect(LedgerLayout({ children: null })).rejects.toThrow("REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/api/auth/login");
  });

  it("rethrows anything else", async () => {
    loadLedgerViewMock.mockRejectedValue(new Error("Database connection failed"));

    await expect(LedgerLayout({ children: null })).rejects.toThrow("Database connection failed");
  });
});

describe("RoutePrefetch", () => {
  const child = React.createElement("main");

  beforeEach(() => {
    vi.clearAllMocks();
    requestHeaders.current = new Headers();
    loadLedgerViewMock.mockResolvedValue(view);
    getLedgerRouteBootstrapMock.mockResolvedValue({ queries: [], mutations: [] });
  });

  it("skips the server fetch on a client-side move between routes", async () => {
    requestHeaders.current = new Headers({ RSC: "1" });

    const tree = await RoutePrefetch({
      tab: "records",
      searchParams: Promise.resolve({}),
      children: child,
    });

    expect(tree).toBe(child);
    expect(getLedgerRouteBootstrapMock).not.toHaveBeenCalled();
  });

  it("prefetches a document request's route and filters for the viewed book", async () => {
    await RoutePrefetch({
      tab: "entries",
      searchParams: Promise.resolve({
        offset: "-1",
        categoryId: "c1",
        search: "tea",
      }),
      children: child,
    });

    expect(getLedgerRouteBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: "entries",
        scope: expect.objectContaining({ bookId: BOOK_B, ledgerToday: "2026-09-26" }),
        period: { range: "month", offset: -1 },
        advancedFilters: expect.objectContaining({ categoryId: "c1", search: "tea" }),
      })
    );
  });

  it("prefetches the stats period the URL names", async () => {
    await RoutePrefetch({
      tab: "stats",
      searchParams: Promise.resolve({ range: "year", offset: "-1" }),
      children: child,
    });

    expect(getLedgerRouteBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({ period: { range: "year", offset: -1 } })
    );
  });

  it("sends a signed-out document request to sign in instead of failing the page", async () => {
    loadLedgerViewMock.mockRejectedValue(new UnauthorizedError());

    await expect(
      RoutePrefetch({ tab: "records", searchParams: Promise.resolve({}), children: child })
    ).rejects.toThrow("REDIRECT");
  });

  it("falls back to client queries when the prefetch fails", async () => {
    getLedgerRouteBootstrapMock.mockRejectedValue(new Error("stats are down"));

    const tree = await RoutePrefetch({
      tab: "stats",
      searchParams: Promise.resolve({}),
      children: child,
    });

    expect(elements(tree)).toContain(child);
  });
});
