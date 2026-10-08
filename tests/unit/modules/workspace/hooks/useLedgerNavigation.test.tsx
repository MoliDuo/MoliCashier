import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLedgerNavigation } from "@/modules/workspace/hooks/useLedgerNavigation";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
const pathname = vi.hoisted(() => ({ current: "/stream" }));
const search = vi.hoisted(() => ({ current: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(search.current),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>;
}

function useHarness() {
  return {
    navigation: useLedgerNavigation(),
    remember: useWorkspaceStore((state) => state.rememberRouteQuery),
  };
}

describe("useLedgerNavigation", () => {
  beforeEach(() => {
    pathname.current = "/records";
    search.current = "";
    window.history.replaceState({}, "", "/records");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the active tab from the route", () => {
    pathname.current = "/stats";
    const { result } = renderHook(useHarness, { wrapper });
    expect(result.current.navigation.activeTab).toBe("stats");
  });

  it("returns to a tab on the filters it was left with, under the current period", () => {
    pathname.current = "/stats";
    search.current = "range=year";
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("records", "offset=-1&categoryId=c1"));

    // The period is one for the whole ledger, so it comes from the route being
    // left; the filters are 账目's own.
    expect(result.current.navigation.hrefFor("records")).toBe("/records?categoryId=c1&range=year");
    act(() => result.current.navigation.navigate("records"));
    expect(router.push).toHaveBeenCalledWith("/records?categoryId=c1&range=year", {
      scroll: false,
    });
  });

  it("carries the period between 账目, 明细 and 统计", () => {
    pathname.current = "/records";
    search.current = "range=year&offset=-1";
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("entries", "categoryId=c1"));

    expect(result.current.navigation.hrefFor("entries")).toBe(
      "/entries?categoryId=c1&range=year&offset=-1"
    );
    expect(result.current.navigation.hrefFor("stats")).toBe("/stats?range=year&offset=-1");
  });

  it("does not carry a period to or from 设置", () => {
    pathname.current = "/settings";
    search.current = "";
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("records", "offset=-1"));

    expect(result.current.navigation.hrefFor("records")).toBe("/records?offset=-1");
    expect(result.current.navigation.hrefFor("settings")).toBe("/settings");
  });

  it("carries the period through 设置 from the last route that showed one", () => {
    pathname.current = "/settings";
    search.current = "";
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("stats", "categoryId=c1"));
    act(() => result.current.remember("records", "range=year&offset=-1&search=tea"));
    act(() => result.current.remember("settings", ""));

    expect(result.current.navigation.hrefFor("stats")).toBe(
      "/stats?categoryId=c1&range=year&offset=-1"
    );
    expect(result.current.navigation.hrefFor("records")).toBe(
      "/records?range=year&offset=-1&search=tea"
    );
  });

  it("goes to an explicit query instead of the remembered one", () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("records", "period=lastMonth"));
    act(() =>
      result.current.navigation.navigate("records", new URLSearchParams("period=thisYear"))
    );
    expect(router.push).toHaveBeenCalledWith("/records?period=thisYear", { scroll: false });
  });

  it("replaces an open record's history entry so Back cannot reopen it", () => {
    window.history.replaceState({}, "", "/records?detail=doc-1");
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.navigation.navigate("stats"));
    expect(router.replace).toHaveBeenCalledWith("/stats", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
  });
});
