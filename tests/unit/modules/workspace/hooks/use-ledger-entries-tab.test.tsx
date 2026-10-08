import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy } from "@/copy/source-document";
import { batchActionsCopy } from "@/copy/workspace";
import type { Period } from "@/modules/ledger/domain/period";
import { queryKeys } from "@/lib/query-keys";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { buildStreamQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";

const mocks = vi.hoisted(() => ({
  fetchStreamPage: vi.fn(),
  fetchStreamTotal: vi.fn(),
  deleteSourceDocument: vi.fn(),
  batchUpdate: vi.fn(),
  batchDelete: vi.fn(),
  batchRetry: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: mocks.toastWarning },
}));
vi.mock("@/modules/source-document/queries", () => ({
  fetchStreamPage: mocks.fetchStreamPage,
  fetchStreamTotal: mocks.fetchStreamTotal,
}));
vi.mock("@/modules/source-document/server-actions/delete", () => ({
  deleteSourceDocumentAction: mocks.deleteSourceDocument,
}));
vi.mock("@/modules/source-document/server-actions/update", () => ({
  batchUpdateSourceDocumentsAction: mocks.batchUpdate,
}));
vi.mock("@/modules/source-document/server-actions/batch", () => ({
  batchDeleteSourceDocumentsAction: mocks.batchDelete,
  batchRetrySourceDocumentsAction: mocks.batchRetry,
}));
vi.mock("@/modules/source-document/server-actions/retry", () => ({
  retrySourceDocumentAction: mocks.retry,
}));
vi.mock("@/modules/source-document/server-actions/processing", () => ({
  cancelSourceDocumentProcessingAction: mocks.cancel,
}));
vi.mock("@/modules/workspace/server-actions/date-impact", () => ({
  previewSourceDocumentDateImpactAction: vi.fn(),
}));

const { useLedgerEntriesTab } = await import("@/modules/workspace/hooks/useLedgerEntriesTab");

const ALL_TIME: Period = { range: "all" };
const JULY: Period = { range: "custom", from: "2026-07-01", to: "2026-07-31" };
const NO_FILTERS: LedgerAdvancedFilters = {};

function newClient(gcTime = 0) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime }, mutations: { retry: false } },
  });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderTab(
  options: { period?: Period; advancedFilters?: LedgerAdvancedFilters } = {},
  client = newClient()
) {
  const period = options.period ?? ALL_TIME;
  const advancedFilters = options.advancedFilters ?? NO_FILTERS;
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useLedgerEntriesTab({ mainCurrency: "CNY", period, advancedFilters }), {
    wrapper: Wrapper,
  });
}

function makeItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Doc ${id}`,
    text: null,
    files: [],
    status: "completed",
    failureMessage: null,
    entryDate: "2026-07-01",
    metadata: {},
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    hasImages: false,
    supportedActions: [],
    errorCode: null,
    latestAttemptId: null,
    ...overrides,
  } as const;
}

function makeEntry(id: string, sourceDocumentId: string) {
  return {
    id,
    categoryId: null,
    sourceDocumentId,
    amount: "20.00",
    currency: "CNY",
    itemName: id,
    description: null,
    convertedAmount: "20.00",
    exchangeRate: "1.000000",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    category: null,
  };
}

type TabResult = ReturnType<typeof renderTab>["result"];

function renderedIds(result: TabResult) {
  return result.current.stream.groups.flatMap((group) =>
    group.items.map((item) => item.sourceDocument.id)
  );
}

async function selectDocuments(result: TabResult, ids: string[]) {
  await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
  act(() => result.current.selection.handleToggleSelectionMode());
  for (const id of ids) act(() => result.current.selection.handleToggleSelection(id));
  expect(result.current.selection.selectedIds).toEqual(ids);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.fetchStreamTotal.mockResolvedValue({ total: "12.00", unconvertedCount: 0 });
  mocks.fetchStreamPage.mockImplementation((params: { cursor?: string }) =>
    Promise.resolve(
      params.cursor == null
        ? {
            items: [
              makeItem("doc-1", { entryDate: "2026-07-15" }),
              makeItem("doc-2", { entryDate: "2026-07-10" }),
            ],
            nextCursor: "next-page-cursor",
            generation: "1",
          }
        : {
            items: [makeItem("doc-3", { entryDate: "2026-07-05" })],
            nextCursor: null,
            generation: "1",
          }
    )
  );
});

describe("useLedgerEntriesTab stream", () => {
  it("fetches the first page and total, and pages on with the prior cursor", async () => {
    const { result } = renderTab();

    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
    expect(mocks.fetchStreamPage).toHaveBeenCalledWith(
      { period: ALL_TIME, limit: 20 },
      { signal: expect.any(AbortSignal) }
    );
    expect(renderedIds(result)).toEqual(["doc-1", "doc-2"]);
    expect(result.current.stream.hasNextPage).toBe(true);
    await waitFor(() => expect(result.current.stream.filteredTotal).toBe("12.00"));
    expect(result.current.stream.hasUnconverted).toBe(false);

    act(() => void result.current.stream.fetchNextPage());
    await waitFor(() => expect(result.current.stream.hasNextPage).toBe(false));
    expect(mocks.fetchStreamPage).toHaveBeenCalledWith(
      {
        period: ALL_TIME,
        cursor: "next-page-cursor",
        limit: 20,
      },
      { signal: expect.any(AbortSignal) }
    );
    expect(renderedIds(result)).toEqual(["doc-1", "doc-2", "doc-3"]);
  });

  it("flags totals that could not be converted", async () => {
    mocks.fetchStreamTotal.mockResolvedValue({ total: "5.00", unconvertedCount: 2 });
    const { result } = renderTab();

    await waitFor(() => expect(result.current.stream.hasUnconverted).toBe(true));
  });

  it("flattens pages and deduplicates by ID preserving server order", async () => {
    mocks.fetchStreamPage
      .mockResolvedValueOnce({
        items: [makeItem("doc-1"), makeItem("doc-2")],
        nextCursor: "cursor-2",
        generation: "1",
      })
      .mockResolvedValueOnce({
        items: [makeItem("doc-1"), makeItem("doc-3")],
        nextCursor: null,
        generation: "1",
      });
    const { result } = renderTab();
    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));

    act(() => void result.current.stream.fetchNextPage());
    await waitFor(() => expect(result.current.stream.hasNextPage).toBe(false));

    expect(renderedIds(result)).toEqual(["doc-1", "doc-2", "doc-3"]);
  });

  it("narrows the page and total queries to the period and filters", async () => {
    renderTab({
      period: JULY,
      advancedFilters: { minAmount: "10", maxAmount: "100", statuses: ["processing", "failed"] },
    });

    const expected = {
      period: JULY,
      minAmount: "10",
      maxAmount: "100",
      // Statuses are sorted for stable cache keys.
      statuses: ["failed", "processing"],
    };
    await waitFor(() =>
      expect(mocks.fetchStreamPage).toHaveBeenCalledWith(
        { ...expected, limit: 20 },
        { signal: expect.any(AbortSignal) }
      )
    );
    expect(mocks.fetchStreamTotal).toHaveBeenCalledWith(expected, {
      signal: expect.any(AbortSignal),
    });
  });

  it("renders the filtered page projection directly from the server page", async () => {
    const entryLatte = makeEntry("entry-latte", "doc-1");
    mocks.fetchStreamPage.mockResolvedValue({
      items: [makeItem("doc-1", { title: "Server page title", ledgerEntries: [entryLatte] })],
      nextCursor: null,
      generation: "1",
    });
    const { result } = renderTab({ advancedFilters: { search: "latte" } });

    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
    expect(mocks.fetchStreamPage).toHaveBeenCalledWith(
      {
        period: ALL_TIME,
        search: "latte",
        limit: 20,
      },
      { signal: expect.any(AbortSignal) }
    );
    const rendered = result.current.stream.groups[0]?.items[0];
    expect(rendered?.sourceDocument.title).toBe("Server page title");
    expect(rendered?.ledgerEntries.map((entry) => entry.id)).toEqual(["entry-latte"]);
  });

  it("reports an error and retries both queries", async () => {
    mocks.fetchStreamTotal.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderTab();

    await waitFor(() => expect(result.current.stream.isError).toBe(true));
    expect(result.current.stream.hasData).toBe(true);

    act(() => result.current.stream.retry());
    await waitFor(() => expect(result.current.stream.isError).toBe(false));
    expect(mocks.fetchStreamTotal).toHaveBeenCalledTimes(2);
  });

  it("keeps the current list until a fresh first page replaces a mismatched generation", async () => {
    const freshPage = deferred<unknown>();
    mocks.fetchStreamPage
      .mockResolvedValueOnce({
        items: [makeItem("doc-1"), makeItem("doc-2")],
        nextCursor: "cursor-2",
        generation: "1",
      })
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        generation: "2",
        restartRequired: true,
      })
      .mockReturnValueOnce(freshPage.promise);
    const { result } = renderTab();
    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));

    act(() => void result.current.stream.fetchNextPage());
    await waitFor(() => expect(mocks.fetchStreamPage).toHaveBeenCalledTimes(3));
    expect(renderedIds(result)).toEqual(["doc-1", "doc-2"]);

    freshPage.resolve({
      items: [makeItem("doc-fresh")],
      nextCursor: null,
      generation: "3",
      hasTransitionalWork: false,
    });
    await waitFor(() => expect(renderedIds(result)).toEqual(["doc-fresh"]));
  });

  it("retains two freshly refetched pages in the same new generation", async () => {
    const client = newClient();
    const reset = vi.spyOn(client, "resetQueries");
    const { result } = renderTab({}, client);
    await waitFor(() => expect(result.current.stream.hasNextPage).toBe(true));
    act(() => void result.current.stream.fetchNextPage());
    await waitFor(() => expect(result.current.stream.hasNextPage).toBe(false));

    mocks.fetchStreamPage.mockClear();
    mocks.fetchStreamPage.mockImplementation((params: { cursor?: string }) =>
      Promise.resolve({
        items: [makeItem(params.cursor == null ? "doc-new-1" : "doc-new-2")],
        nextCursor: params.cursor == null ? "new-cursor" : null,
        generation: "2",
      })
    );
    act(() => result.current.stream.retry());

    await waitFor(() => expect(renderedIds(result)).toEqual(["doc-new-1", "doc-new-2"]));
    expect(mocks.fetchStreamPage).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
    expect(
      client.getQueryData<{ pages: unknown[] }>(
        buildStreamQueryDescriptor({ period: ALL_TIME }).queryKey
      )?.pages
    ).toHaveLength(2);
  });

  it("retries an invalid first page once before exposing stream data", async () => {
    mocks.fetchStreamPage
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        generation: "1",
        restartRequired: true,
        hasTransitionalWork: false,
      })
      .mockResolvedValueOnce({
        items: [makeItem("doc-fresh")],
        nextCursor: null,
        generation: "2",
        hasTransitionalWork: true,
      });
    const client = newClient(Infinity);
    const { result } = renderTab({}, client);

    await waitFor(() => expect(result.current.stream.hasData).toBe(true));
    expect(mocks.fetchStreamPage).toHaveBeenCalledTimes(2);
    expect(renderedIds(result)).toEqual(["doc-fresh"]);
    // The sync version is the refresh driver's alone; a list never writes it.
    expect(client.getQueryData(queryKeys.ledgerSync())).toBeUndefined();
  });

  it("fails a first-page fetch that requests two consecutive restarts", async () => {
    mocks.fetchStreamPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      generation: "1",
      restartRequired: true,
      hasTransitionalWork: false,
    });
    const client = newClient(Infinity);
    const { result } = renderTab({}, client);

    await waitFor(() => expect(result.current.stream.isError).toBe(true));
    expect(result.current.stream.hasData).toBe(false);
    expect(mocks.fetchStreamPage).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKeys.ledgerSync())).toBeUndefined();
  });
});

describe("useLedgerEntriesTab selection and batch commands", () => {
  it("marks the document while selecting and collects the selected entries", async () => {
    mocks.fetchStreamPage.mockResolvedValue({
      items: [
        makeItem("doc-1", {
          ledgerEntries: [makeEntry("entry-1", "doc-1"), makeEntry("entry-2", "doc-1")],
        }),
        makeItem("doc-2", { ledgerEntries: [makeEntry("entry-3", "doc-2")] }),
      ],
      nextCursor: null,
      generation: "1",
    });
    const { result, unmount } = renderTab();

    await selectDocuments(result, ["doc-1"]);
    expect(result.current.selection.selectedEntryIds).toEqual(["entry-1", "entry-2"]);
    expect(result.current.selection.hasMoreData).toBe(false);

    act(() => result.current.selection.handleSelectAll());
    expect(result.current.selection.isAllSelected).toBe(true);
    act(() => result.current.selection.handleClearSelection());
    expect(result.current.selection.selectedIds).toEqual([]);

    unmount();
  });

  it("selects exactly the loaded records whose processing failed or was cancelled", async () => {
    mocks.fetchStreamPage.mockResolvedValue({
      items: [
        makeItem("doc-1", { processingStatus: "completed" }),
        makeItem("doc-2", { processingStatus: "failed" }),
        makeItem("doc-3", { processingStatus: "processing" }),
        makeItem("doc-4", { processingStatus: "cancelled" }),
        makeItem("doc-5", { processingStatus: null }),
      ],
      nextCursor: null,
      generation: "1",
    });
    const { result } = renderTab();

    await selectDocuments(result, ["doc-1"]);
    expect(result.current.selection.abnormalCount).toBe(2);
    act(() => result.current.selection.handleSelectAbnormal());
    expect([...result.current.selection.selectedIds].sort()).toEqual(["doc-2", "doc-4"]);
  });

  it("does not clear selection or show success when a batch date update fails", async () => {
    mocks.batchUpdate.mockRejectedValueOnce(new Error("not found"));
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1"]);

    act(() => result.current.selection.handleUpdateDates("2026-09-04", ["doc-1"]));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(commonCopy.error));
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      sourceDocumentIds: ["doc-1"],
      data: { documentDate: "2026-09-04" },
    });
    expect(result.current.selection.selectedIds).toEqual(["doc-1"]);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("clears the selection after the dates move", async () => {
    mocks.batchUpdate.mockResolvedValueOnce({ updatedCount: 2 });
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1", "doc-2"]);

    act(() => result.current.selection.handleUpdateDates("2026-09-04", ["doc-1", "doc-2"]));

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(batchActionsCopy.datesUpdated({ count: 2 }))
    );
    expect(result.current.selection.selectedIds).toEqual([]);
  });

  it("keeps failed documents selected after a partial batch delete", async () => {
    mocks.batchDelete.mockResolvedValueOnce({
      succeeded: [{ id: "doc-1", sourceDocumentId: "doc-1" }],
      failed: [{ id: "doc-2", code: "processing" }],
    });
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1", "doc-2"]);
    const onCommitted = vi.fn();

    let closed: boolean | undefined;
    await act(async () => {
      closed = await result.current.selection.handleDelete(onCommitted);
    });

    expect(mocks.batchDelete).toHaveBeenCalledWith(["doc-1", "doc-2"]);
    expect(closed).toBe(false);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(batchActionsCopy.deleted({ count: 1 }));
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      batchActionsCopy.partialResult({ succeeded: 1, failed: 1 })
    );
    expect(result.current.selection.selectedIds).toEqual(["doc-2"]);
  });

  it("closes the batch delete and clears the selection when everything is deleted", async () => {
    mocks.batchDelete.mockResolvedValueOnce({
      succeeded: [{ id: "doc-1", sourceDocumentId: "doc-1" }],
      failed: [],
    });
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1"]);
    const onCommitted = vi.fn();

    await act(async () => {
      await result.current.selection.handleDelete(onCommitted);
    });

    expect(onCommitted).toHaveBeenCalledOnce();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(result.current.selection.selectedIds).toEqual([]);
  });

  it("locks the selection while a batch retry runs", async () => {
    const command = deferred<unknown>();
    mocks.batchRetry.mockReturnValueOnce(command.promise);
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1"]);

    act(() => void result.current.selection.handleRetry());
    await waitFor(() => expect(result.current.selection.isBatchPending).toBe(true));
    expect(mocks.batchRetry).toHaveBeenCalledWith(["doc-1"]);
    act(() => result.current.selection.handleToggleSelection("doc-2"));
    act(() => result.current.selection.handleToggleSelectionMode());
    expect(result.current.selection.selectedIds).toEqual(["doc-1"]);
    expect(result.current.selection.isSelectionMode).toBe(true);

    await act(async () => {
      command.resolve({ succeeded: [{ id: "doc-1", sourceDocumentId: "doc-1" }], failed: [] });
      await command.promise;
    });
    await waitFor(() => expect(result.current.selection.isRetrying).toBe(false));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(batchActionsCopy.retried({ count: 1 }));
    expect(result.current.selection.selectedIds).toEqual([]);
  });
});

describe("useLedgerEntriesTab single-record delete", () => {
  const doc = { id: "doc-1" } as SourceDocumentListItemDto;

  it("reports deletion success and failure exactly once", async () => {
    const { result } = renderTab();
    await selectDocuments(result, ["doc-1"]);
    mocks.deleteSourceDocument.mockResolvedValueOnce({ sourceDocumentId: "doc-1", deleted: true });

    act(() => result.current.actions.handleRequestDelete(doc));
    expect(result.current.dialogs.deleteConfirmOpen).toBe(true);
    await act(() => result.current.actions.handleConfirmDelete());

    expect(mocks.deleteSourceDocument).toHaveBeenCalledWith("doc-1");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(commonCopy.deleteSuccess);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.dialogs.deleteConfirmOpen).toBe(false);
    expect(result.current.selection.selectedIds).toEqual([]);

    mocks.deleteSourceDocument.mockRejectedValueOnce(new Error("delete failed"));
    act(() => result.current.actions.handleRequestDelete(doc));
    await act(async () => {
      await expect(result.current.actions.handleConfirmDelete()).rejects.toThrow("delete failed");
    });

    expect(mocks.toastError).toHaveBeenCalledWith(commonCopy.deleteFailed);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(result.current.dialogs.deleteConfirmOpen).toBe(true);
  });

  it("closes the confirmation and finishes before the refresh settles", async () => {
    const client = newClient();
    const refreshGate = deferred();
    const { result } = renderTab({}, client);
    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
    vi.spyOn(client, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    mocks.deleteSourceDocument.mockResolvedValueOnce({ sourceDocumentId: "doc-1", deleted: true });

    act(() => result.current.actions.handleRequestDelete(doc));
    await act(() => result.current.actions.handleConfirmDelete());

    expect(mocks.toastSuccess).toHaveBeenCalledWith(commonCopy.deleteSuccess);
    expect(result.current.dialogs.deleteConfirmOpen).toBe(false);
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    await act(async () => refreshGate.resolve());
  });

  it("reports refresh failures separately from mutation error feedback", async () => {
    const client = newClient();
    const { result } = renderTab({}, client);
    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(client, "invalidateQueries").mockRejectedValue(new Error("offline"));
    mocks.deleteSourceDocument.mockResolvedValueOnce({ sourceDocumentId: "doc-1", deleted: true });

    act(() => result.current.actions.handleRequestDelete(doc));
    await act(() => result.current.actions.handleConfirmDelete());

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(commonCopy.savedRefreshFailed)
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(commonCopy.deleteSuccess);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe("useLedgerEntriesTab row recovery", () => {
  it.each([
    ["retry", "retryingIds", mocks.retry, sourceDocumentActionCopy.retrySuccess],
    ["cancelProcessing", "cancellingIds", mocks.cancel, sourceDocumentActionCopy.cancelSuccess],
  ] as const)(
    "keeps %s locked until cache invalidation completes",
    async (method, pendingKey, action, successKey) => {
      const client = newClient();
      const { result } = renderTab({}, client);
      await waitFor(() => expect(result.current.stream.isLoading).toBe(false));
      const command = deferred<unknown>();
      const invalidation = deferred();
      action.mockReturnValue(command.promise);
      const invalidate = vi
        .spyOn(client, "invalidateQueries")
        .mockImplementation(() => invalidation.promise);
      const initialAction = result.current.recovery[method];

      act(() => {
        void result.current.recovery[method]({ sourceDocumentId: "doc-1" });
        void result.current.recovery[method]({ sourceDocumentId: "doc-1" });
      });
      await waitFor(() => expect(action).toHaveBeenCalledWith("doc-1"));
      expect(action).toHaveBeenCalledTimes(1);
      expect(result.current.recovery[pendingKey].has("doc-1")).toBe(true);
      expect(result.current.recovery[method]).toBe(initialAction);

      command.resolve({});
      await waitFor(() => expect(invalidate).toHaveBeenCalled());
      expect(mocks.toastSuccess).toHaveBeenCalledWith(successKey);
      expect(result.current.recovery[pendingKey].has("doc-1")).toBe(true);

      act(() => {
        void result.current.recovery[method]({ sourceDocumentId: "doc-1" });
      });
      expect(action).toHaveBeenCalledTimes(1);

      await act(async () => invalidation.resolve());
      await waitFor(() => expect(result.current.recovery[pendingKey].has("doc-1")).toBe(false));
      expect(result.current.recovery[method]).toBe(initialAction);
    }
  );

  it("releases the row after a failed retry", async () => {
    mocks.retry.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderTab();
    await waitFor(() => expect(result.current.stream.isLoading).toBe(false));

    await act(() => result.current.recovery.retry({ sourceDocumentId: "doc-1" }));

    expect(mocks.toastError).toHaveBeenCalledWith(sourceDocumentActionCopy.retryError);
    expect(result.current.recovery.retryingIds.has("doc-1")).toBe(false);
  });
});
