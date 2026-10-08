import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";
import { queryKeys } from "@/lib/query-keys";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const { getLedgerActionMock, getEntryCategoriesActionMock } = vi.hoisted(() => ({
  getLedgerActionMock: vi.fn(),
  getEntryCategoriesActionMock: vi.fn(),
}));

vi.mock("@/modules/ledger/queries", () => ({
  fetchLedger: getLedgerActionMock,
  fetchEntryCategories: getEntryCategoriesActionMock,
}));

import { useLedgerPageEnvironment } from "@/modules/workspace/hooks/useLedgerPageEnvironment";

const ledgerDto: LedgerDto = {
  settings: { ...getDefaultLedger().settings, mainCurrency: "USD" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderEnvironment({ withInitialData = true }: { withInitialData?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (withInitialData) {
    client.setQueryData(queryKeys.ledger(), ledgerDto);
    client.setQueryData(queryKeys.entryCategories(), [] as EntryCategoryWithCount[]);
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>
      </QueryClientProvider>
    );
  }
  return renderHook(
    () => ({
      environment: useLedgerPageEnvironment(),
      ready: useWorkspaceStore((state) => state.ready),
    }),
    { wrapper: Wrapper }
  );
}

describe("useLedgerPageEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the hydrated ledger and categories without a browser round trip", () => {
    const { result } = renderEnvironment();

    expect(getLedgerActionMock).not.toHaveBeenCalled();
    expect(getEntryCategoriesActionMock).not.toHaveBeenCalled();
    expect(result.current.environment.mainCurrency).toBe("USD");
    expect(result.current.environment.ledger?.settings.timeZone).toBe("Asia/Shanghai");
  });

  it("reads the ledger and categories through the session query client when the server sent none", async () => {
    getLedgerActionMock.mockResolvedValue({
      ...ledgerDto,
      settings: { ...ledgerDto.settings, mainCurrency: "EUR" },
    });
    getEntryCategoriesActionMock.mockResolvedValue([]);

    const { result } = renderEnvironment({ withInitialData: false });

    await waitFor(() =>
      expect(getLedgerActionMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
    );
    expect(getEntryCategoriesActionMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    await waitFor(() => expect(result.current.environment.mainCurrency).toBe("EUR"));
  });

  it("lets the navigation go once the page has mounted", () => {
    const { result } = renderEnvironment();

    expect(result.current.ready).toBe(true);
  });
});
