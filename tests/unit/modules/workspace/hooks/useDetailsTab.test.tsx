import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_ASSIGNMENT_MAX_ENTRIES } from "@/config/tuning";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy } from "@/copy/workspace";
import type { ActiveLedgerEntryDto } from "@/modules/ledger/contracts";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
import { useDetailsTab } from "@/modules/workspace/hooks/useDetailsTab";

const {
  batchDeleteLedgerEntriesActionMock,
  batchUpdateLedgerEntriesActionMock,
  batchUpdateLedgerEntryDatesActionMock,
  fetchBatchEntryDateImpactMock,
  startCategoryAssignmentActionMock,
  categoryAssignmentJobMock,
  fetchLedgerEntriesMock,
  fetchLedgerSummaryMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  batchDeleteLedgerEntriesActionMock: vi.fn(),
  batchUpdateLedgerEntriesActionMock: vi.fn(),
  batchUpdateLedgerEntryDatesActionMock: vi.fn(),
  fetchBatchEntryDateImpactMock: vi.fn(),
  startCategoryAssignmentActionMock: vi.fn(),
  categoryAssignmentJobMock: vi.fn(),
  fetchLedgerEntriesMock: vi.fn(),
  fetchLedgerSummaryMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/modules/ledger/server-actions/entries", () => ({
  batchDeleteLedgerEntriesAction: batchDeleteLedgerEntriesActionMock,
  batchUpdateLedgerEntriesAction: batchUpdateLedgerEntriesActionMock,
  batchUpdateLedgerEntryDatesAction: batchUpdateLedgerEntryDatesActionMock,
}));

vi.mock("@/modules/ledger/server-actions/category-assignment", () => ({
  startCategoryAssignmentAction: startCategoryAssignmentActionMock,
}));

vi.mock("@/modules/ledger/queries", () => ({
  fetchBatchEntryDateImpact: fetchBatchEntryDateImpactMock,
  fetchCategoryAssignmentJob: categoryAssignmentJobMock,
  fetchLedgerEntries: fetchLedgerEntriesMock,
  fetchLedgerSummary: fetchLedgerSummaryMock,
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

type DetailsTabOptions = Parameters<typeof useDetailsTab>[0];

const baseOptions: DetailsTabOptions = {
  period: { range: "all" },
  advancedFilters: {},
};

/** Renders the tab over one loaded page of entries and waits for it to settle. */
async function renderDetailsTab(entries: ActiveLedgerEntryDto[]) {
  fetchLedgerEntriesMock.mockResolvedValue({ items: entries, nextCursor: null });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <CategoryAssignmentProvider>{children}</CategoryAssignmentProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook((options: DetailsTabOptions) => useDetailsTab(options), {
    wrapper,
    initialProps: baseOptions,
  });
  await waitFor(() => {
    expect(rendered.result.current.queryStatus).toBe("success");
    expect(rendered.result.current.entries).toHaveLength(entries.length);
  });
  return { ...rendered, queryClient };
}

function entry(
  id: string,
  sourceDocumentId = "document-1",
  { date = "2026-09-04", convertedAmount = "1" }: { date?: string; convertedAmount?: string } = {}
): ActiveLedgerEntryDto {
  return {
    id,
    categoryId: null,
    sourceDocumentId,
    amount: "1",
    currency: "CNY",
    itemName: id,
    description: null,
    convertedAmount,
    exchangeRate: "1",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    sourceDocument: {
      id: sourceDocumentId,
      version: 1,
      title: null,
      documentDate: date,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
  };
}

function assignmentJob(status: "pending" | "running" | "succeeded" = "pending") {
  return {
    id: "job-1",

    mode: { kind: "ai" as const, candidateCategoryIds: ["category-1", "category-2"] },
    status,
    total: 1,
    processedCount: status === "succeeded" ? 1 : 0,
    appliedCount: status === "succeeded" ? 1 : 0,
    confirmedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 1,
    documentCompleted: status === "succeeded" ? 1 : 0,
    activeDocumentCount: status === "running" ? 1 : 0,
    retryingDocumentCount: 0,
    nextRetryAt: null,
    candidateCategories: [],
    errorCode: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    completedAt: status === "succeeded" ? "2026-09-04T00:00:01.000Z" : null,
    canRetryFailed: false,
    evidenceIncomplete: false,
  };
}

const dateImpact = (
  entryCount: number
): {
  selectedEntryCount: number;
  sourceDocumentCount: number;
  affectedEntryCount: number;
  sourceDocumentIds: string[];
} => ({
  selectedEntryCount: entryCount,
  sourceDocumentCount: entryCount === 0 ? 0 : 1,
  affectedEntryCount: entryCount,
  sourceDocumentIds: entryCount === 0 ? [] : ["document-1"],
});

const succeededJob = () => ({
  ...assignmentJob("running"),
  status: "succeeded" as const,
  processedCount: 1,
  appliedCount: 1,
  documentCompleted: 1,
  activeDocumentCount: 0,
  completedAt: "2026-09-04T00:00:01.000Z",
});

describe("useDetailsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    categoryAssignmentJobMock.mockResolvedValue(null);
    fetchLedgerSummaryMock.mockResolvedValue({
      unconvertedCount: 0,
      convertedTotal: { total: "0", currency: "CNY" },
      totals: [],
      trend: [],
    });
    startCategoryAssignmentActionMock.mockResolvedValue({ ok: true, job: assignmentJob() });
  });

  it("groups entries by day in the order they were read, with decimal totals", async () => {
    const { result } = await renderDetailsTab([
      entry("new-large", "document-1", { date: "2026-03-01", convertedAmount: "9007199254740993" }),
      entry("new-small", "document-2", { date: "2026-03-01", convertedAmount: "0.25" }),
      entry("old", "document-3", { date: "2020-03-01", convertedAmount: "1" }),
    ]);

    expect(
      result.current.groupedItems.map((group) => ({
        ids: group.items.map((item) => item.id),
        total: group.total,
      }))
    ).toEqual([
      { ids: ["new-large", "new-small"], total: "9007199254740993.25" },
      { ids: ["old"], total: "1" },
    ]);
  });

  it("takes the total from the summary read", async () => {
    fetchLedgerSummaryMock.mockResolvedValue({
      unconvertedCount: 2,
      convertedTotal: { total: "42.5", currency: "USD" },
      totals: [],
      trend: [],
    });
    const { result } = await renderDetailsTab([entry("entry-1")]);

    expect(result.current.monthStats).toEqual({
      mainTotal: "42.5",
      mainCurrency: "USD",
      unconvertedCount: 2,
    });
  });

  it("holds the selection while a command is in flight", async () => {
    const write = deferred();
    batchUpdateLedgerEntriesActionMock.mockImplementationOnce(async () => {
      await write.promise;
      return { ledgerEntryIds: ["entry-1"], affectedCount: 1 };
    });
    const { result } = await renderDetailsTab([entry("entry-1"), entry("entry-2")]);
    act(() => result.current.toggleEntrySelection("entry-1"));
    act(() => void result.current.update.mutateAsync({ currency: "USD" }));
    await waitFor(() => expect(result.current.isPending).toBe(true));

    act(() => {
      result.current.toggleEntrySelection("entry-2");
      result.current.setGroupSelection(["entry-2"], true);
    });
    expect(result.current.selectedIds).toEqual(["entry-1"]);

    await act(async () => {
      write.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("closes delete confirmation and finishes before refresh settles", async () => {
    const { result, queryClient } = await renderDetailsTab([entry("entry-1")]);
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchDeleteLedgerEntriesActionMock.mockResolvedValueOnce({
      succeeded: [{ id: "entry-1", sourceDocumentId: "document-1" }],
      failed: [],
    });

    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.setDeleteDialogOpen(true);
    });
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.remove.mutateAsync();
    });

    await act(async () => Promise.resolve());
    expect(result.current.remove.isPending).toBe(false);
    expect(result.current.deleteDialogOpen).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("leaves selection mode once a batch delete went through, so the list reads again", async () => {
    const { result } = await renderDetailsTab([entry("entry-1"), entry("entry-2")]);
    batchDeleteLedgerEntriesActionMock.mockResolvedValueOnce({
      succeeded: [{ id: "entry-1", sourceDocumentId: "document-1" }],
      failed: [],
    });
    act(() => result.current.setSelectionMode(true));
    act(() => result.current.handleSelect("entry-1", true));
    expect(result.current.isSelectionMode).toBe(true);

    await act(async () => {
      await result.current.remove.mutateAsync();
    });

    expect(result.current.isSelectionMode).toBe(false);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("keeps selection mode on the entries a batch delete could not remove", async () => {
    const { result } = await renderDetailsTab([entry("entry-1"), entry("entry-2")]);
    batchDeleteLedgerEntriesActionMock.mockResolvedValueOnce({
      succeeded: [{ id: "entry-1", sourceDocumentId: "document-1" }],
      failed: [{ id: "entry-2", sourceDocumentId: "document-2", code: "processing" }],
    });
    act(() => result.current.setSelectionMode(true));
    act(() => result.current.handleSelectMany(["entry-1", "entry-2"], true));

    await act(async () => {
      await result.current.remove.mutateAsync();
    });

    expect(result.current.isSelectionMode).toBe(true);
    expect(result.current.selectedIds).toEqual(["entry-2"]);
  });

  it("closes the date dialog and finishes before refresh settles", async () => {
    const { result, queryClient } = await renderDetailsTab([entry("entry-1")]);
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchUpdateLedgerEntryDatesActionMock.mockResolvedValueOnce({
      impact: { affectedEntryCount: 1 },
    });
    fetchBatchEntryDateImpactMock.mockResolvedValueOnce({
      selectedEntryCount: 1,
      sourceDocumentCount: 0,
      affectedEntryCount: 1,
      sourceDocumentIds: [],
    });

    act(() => {
      result.current.handleSelect("entry-1", true);
    });
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.updateDates.mutateAsync();
    });

    await act(async () => Promise.resolve());
    expect(result.current.updateDates.isPending).toBe(false);
    expect(result.current.dateDialogOpen).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("clears selection and finishes the batch update before refresh", async () => {
    const { result, queryClient } = await renderDetailsTab([entry("entry-1")]);
    const refreshGate = deferred();
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(() => refreshGate.promise);
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ledgerEntryIds: ["entry-1"],
      affectedCount: 1,
    });

    act(() => result.current.handleSelect("entry-1", true));
    let mutation!: Promise<unknown>;
    act(() => {
      mutation = result.current.update.mutateAsync({ categoryId: "category-1" });
    });

    await act(async () => Promise.resolve());
    expect(result.current.update.isPending).toBe(false);
    expect(result.current.selectedIds).toEqual([]);

    await act(async () => {
      refreshGate.resolve();
      await mutation;
    });
  });

  it("confirms a date preview while its captured selection is unchanged", async () => {
    fetchBatchEntryDateImpactMock.mockResolvedValueOnce({
      selectedEntryCount: 2,
      sourceDocumentCount: 1,
      affectedEntryCount: 2,
      sourceDocumentIds: ["document-1"],
    });
    batchUpdateLedgerEntryDatesActionMock.mockResolvedValueOnce({
      impact: { affectedEntryCount: 2 },
    });
    const { result } = await renderDetailsTab([entry("entry-1"), entry("entry-2")]);

    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.handleSelect("entry-2", true);
    });
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());
    expect(fetchBatchEntryDateImpactMock).toHaveBeenCalledWith(["entry-1", "entry-2"]);

    await act(async () => {
      await result.current.updateDates.mutateAsync();
    });
    expect(batchUpdateLedgerEntryDatesActionMock).toHaveBeenCalledWith(
      ["document-1"],
      ["entry-1", "entry-2"],
      result.current.selectedDate
    );
  });

  it("keeps selection when a batch update fails", async () => {
    batchUpdateLedgerEntriesActionMock.mockRejectedValueOnce(new Error("Ledger entry not found"));
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));

    await expect(result.current.update.mutateAsync({ categoryId: "category-1" })).rejects.toThrow(
      "Ledger entry not found"
    );

    expect(result.current.selectedIds).toEqual(["entry-1"]);
    expect(toastErrorMock).toHaveBeenCalledWith(commonCopy.error);
  });

  it("keeps the date dialog and selection when confirmation fails", async () => {
    fetchBatchEntryDateImpactMock.mockResolvedValueOnce({
      selectedEntryCount: 1,
      sourceDocumentCount: 1,
      affectedEntryCount: 1,
      sourceDocumentIds: ["document-1"],
    });
    batchUpdateLedgerEntryDatesActionMock.mockRejectedValueOnce(
      new Error("Ledger entry not found")
    );
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.openDateDialog());
    await act(async () => Promise.resolve());

    await expect(result.current.updateDates.mutateAsync()).rejects.toThrow(
      "Ledger entry not found"
    );

    expect(result.current.dateDialogOpen).toBe(true);
    expect(result.current.selectedIds).toEqual(["entry-1"]);
  });

  it("leaves the dialog open with the failure when the preview cannot be computed", async () => {
    fetchBatchEntryDateImpactMock.mockRejectedValueOnce(new Error("preview down"));
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => {
      result.current.handleSelect("entry-1", true);
      result.current.openDateDialog();
    });
    await act(async () => Promise.resolve());

    expect(result.current.dateDialogOpen).toBe(true);
    expect(result.current.datePreviewFailed).toBe(true);
    expect(result.current.dateImpact).toBeNull();
  });

  it("starts an AI sort for the captured selection and clears it", async () => {
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick("category-2", true);
    });

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(startCategoryAssignmentActionMock).toHaveBeenCalledWith({
      requestKey: expect.any(String),
      mode: { kind: "ai", candidateCategoryIds: ["category-1", "category-2"] },
      ledgerEntryIds: ["entry-1"],
    });
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.categoryDialogOpen).toBe(false);
    expect(toastSuccessMock).toHaveBeenCalledWith(batchActionsCopy.aiCategoryRunning);
  });

  it("says once that another run is busy when the server refuses the start", async () => {
    startCategoryAssignmentActionMock.mockResolvedValueOnce({ ok: false, code: "busy" });
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick("category-2", true);
    });

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(toastErrorMock).toHaveBeenCalledExactlyOnceWith(batchActionsCopy.aiCategoryBusy);
    expect(result.current.selectedIds).toEqual(["entry-1"]);
  });

  it("writes one picked category straight through instead of asking the model", async () => {
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ledgerEntryIds: ["entry-1"],
      affectedCount: 1,
    });
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledWith(
      expect.anything(),
      ["entry-1"],
      { categoryId: "category-1" }
    );
    expect(startCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(result.current.categoryDialogOpen).toBe(false);
  });

  it("takes the clear row as an answer, and drops the categories it excluded", async () => {
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ledgerEntryIds: ["entry-1"],
      affectedCount: 1,
    });
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick(null, true);
    });

    expect(result.current.pickedCategoryIds).toEqual([]);
    expect(result.current.clearCategoryPicked).toBe(true);

    await act(async () => result.current.confirmCategory());
    await act(async () => Promise.resolve());

    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledWith(
      expect.anything(),
      ["entry-1"],
      { categoryId: null }
    );
    expect(startCategoryAssignmentActionMock).not.toHaveBeenCalled();
  });

  it("freezes the list while selecting and reads it again afterwards", async () => {
    const { result, queryClient } = await renderDetailsTab([entry("entry-1")]);
    const reads = fetchLedgerEntriesMock.mock.calls.length;

    act(() => result.current.toggleSelectionMode());
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["ledger"] });
    });
    expect(fetchLedgerEntriesMock).toHaveBeenCalledTimes(reads);

    act(() => result.current.toggleSelectionMode());
    await waitFor(() => expect(fetchLedgerEntriesMock.mock.calls.length).toBeGreaterThan(reads));
  });

  it("writes a single pick straight through at the direct limit", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `entry-${index}`);
    batchUpdateLedgerEntriesActionMock.mockResolvedValueOnce({
      ledgerEntryIds: ids,
      affectedCount: 100,
    });
    const { result } = await renderDetailsTab(ids.map((id) => entry(id)));
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(startCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(batchUpdateLedgerEntriesActionMock).toHaveBeenCalledTimes(1);
    expect(result.current.categoryDialogOpen).toBe(false);
  });

  it("asks the model once a single pick passes the direct limit", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `entry-${index}`);
    const { result } = await renderDetailsTab(ids.map((id) => entry(id)));
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(batchUpdateLedgerEntriesActionMock).not.toHaveBeenCalled();
    expect(startCategoryAssignmentActionMock).toHaveBeenCalledWith({
      requestKey: expect.any(String),
      mode: { kind: "assign", categoryId: "category-1" },
      ledgerEntryIds: ids,
    });
  });

  it("refuses a selection above the run limit without starting anything", async () => {
    const ids = Array.from({ length: 5001 }, (_, index) => `entry-${index}`);
    const { result } = await renderDetailsTab(ids.map((id) => entry(id)));
    act(() => result.current.handleSelectMany(ids, true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(startCategoryAssignmentActionMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      batchActionsCopy.categorySelectionTooLarge({ max: CATEGORY_ASSIGNMENT_MAX_ENTRIES })
    );
    expect(result.current.categoryDialogOpen).toBe(true);
  });

  it("keeps the picks when the direct write fails", async () => {
    batchUpdateLedgerEntriesActionMock.mockRejectedValueOnce(new Error("write failed"));
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => result.current.toggleCategoryPick("category-1", true));

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });

    expect(result.current.categoryDialogOpen).toBe(true);
    expect(result.current.pickedCategoryIds).toEqual(["category-1"]);
    expect(startCategoryAssignmentActionMock).not.toHaveBeenCalled();
  });

  it("keeps following a run after its dialog is closed", async () => {
    const running = assignmentJob("running");
    categoryAssignmentJobMock.mockResolvedValueOnce(null).mockImplementation(async () => ({
      ...running,
    }));
    const { result, queryClient } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.setCategoryDialogOpen(true));
    act(() => {
      result.current.toggleCategoryPick("category-1", true);
      result.current.toggleCategoryPick("category-2", true);
    });

    await act(async () => {
      result.current.confirmCategory();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.categoryDialogOpen).toBe(false));

    // The dialog is gone but the run is not: the page still holds it, and still
    // reports its outcome once it ends.
    const runQueryKey = ["ledger", "category-assignment"];
    await waitFor(() =>
      expect(queryClient.getQueryData(runQueryKey)).toMatchObject({ id: "job-1" })
    );
    categoryAssignmentJobMock.mockImplementation(async () => succeededJob());
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: runQueryKey });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(runQueryKey)).toMatchObject({ status: "succeeded" })
    );
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        batchActionsCopy.aiCategoryDone({ applied: 1, confirmed: 0, issues: 0 }),
        {}
      )
    );
  });

  it("ignores a date preview that lands after the dialog was reopened", async () => {
    const firstPreview = deferred();
    fetchBatchEntryDateImpactMock
      .mockImplementationOnce(async () => {
        await firstPreview.promise;
        return dateImpact(2);
      })
      .mockResolvedValueOnce(dateImpact(1));
    const { result } = await renderDetailsTab([entry("entry-1"), entry("entry-2")]);
    act(() => result.current.handleSelectMany(["entry-1", "entry-2"], true));
    act(() => result.current.openDateDialog());
    act(() => result.current.setDateDialogOpen(false));
    act(() => result.current.handleSelect("entry-2", false));
    act(() => result.current.openDateDialog());

    await waitFor(() => expect(result.current.dateImpact).toEqual(dateImpact(1)));
    await act(async () => {
      firstPreview.resolve();
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());

    expect(result.current.dateImpact).toEqual(dateImpact(1));
    expect(result.current.updateDates.isPending).toBe(false);
  });

  it("retries a failed date preview inside the open dialog", async () => {
    fetchBatchEntryDateImpactMock
      .mockRejectedValueOnce(new Error("preview down"))
      .mockResolvedValueOnce(dateImpact(1));
    const { result } = await renderDetailsTab([entry("entry-1")]);
    act(() => result.current.handleSelect("entry-1", true));
    act(() => result.current.openDateDialog());
    await waitFor(() => expect(result.current.datePreviewFailed).toBe(true));
    expect(result.current.dateDialogOpen).toBe(true);

    act(() => result.current.retryDatePreview());

    await waitFor(() => expect(result.current.dateImpact).toEqual(dateImpact(1)));
    expect(result.current.datePreviewFailed).toBe(false);
  });
});
