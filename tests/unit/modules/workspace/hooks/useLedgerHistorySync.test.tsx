import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLedgerHistorySync } from "@/modules/workspace/hooks/useLedgerHistorySync";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";

const detailId = "document-1";
const detailSearch = `detail=${detailId}`;

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>;
}

function renderSync(activeTab: LedgerTab, search: string) {
  return renderHook(
    ({ tab, query }: { tab: LedgerTab; query: string }) => {
      useLedgerHistorySync({
        activeTab: tab,
        pathname: `/${tab}`,
        searchParams: new URLSearchParams(query),
      });
      return useWorkspaceStore((state) => state);
    },
    { wrapper, initialProps: { tab: activeTab, query: search } }
  );
}

describe("useLedgerHistorySync", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/records?${detailSearch}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("remembers each route's query without the open record", () => {
    const { result, rerender } = renderSync("records", `search=tea&${detailSearch}`);
    expect(result.current.routeQueries.records).toBe("search=tea");

    rerender({ tab: "stats", query: "range=year" });
    expect(result.current.routeQueries).toEqual({ records: "search=tea", stats: "range=year" });
  });

  it("drops a custom period it cannot read", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    renderSync("records", "range=custom&from=2026-02-01&categoryId=c1");
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(expect.anything(), "", "/records?categoryId=c1")
    );
  });
});
