import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchActionsCopy } from "@/copy/workspace";
import type { CategoryAssignmentJob } from "@/modules/ledger/contracts";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import { useCategoryAssignmentEntryState } from "@/modules/ledger/ui/category-assignment-entry-states";

const { getJob, getEntryStates, toastSuccess, toastError, toastLoading, toastDismiss } = vi.hoisted(
  () => ({
    getJob: vi.fn(),
    getEntryStates: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastLoading: vi.fn(),
    toastDismiss: vi.fn(),
  })
);

vi.mock("@/modules/ledger/queries", () => ({
  fetchCategoryAssignmentJob: getJob,
  fetchCategoryAssignmentEntryStates: getEntryStates,
  fetchCategoryAssignmentResults: vi.fn(async () => ({ items: [], nextCursor: null })),
}));
vi.mock("@/lib/mutations/ledger-invalidation", () => ({
  invalidateLedgerQueries: vi.fn(async () => undefined),
}));
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: toastLoading,
    dismiss: toastDismiss,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/modules/ledger/server-actions/category-assignment", () => ({
  cancelCategoryAssignmentAction: vi.fn(),
  retryCategoryAssignmentFailuresAction: vi.fn(),
  retryCategoryAssignmentLatestAction: vi.fn(),
}));

function job(overrides: Partial<CategoryAssignmentJob> = {}): CategoryAssignmentJob {
  return {
    id: "job-1",

    mode: { kind: "ai", candidateCategoryIds: ["category-1"] },
    status: "running",
    total: 10,
    processedCount: 4,
    appliedCount: 3,
    confirmedCount: 1,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 10,
    documentCompleted: 4,
    activeDocumentCount: 2,
    retryingDocumentCount: 0,
    nextRetryAt: null,
    candidateCategories: [],
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    completedAt: null,
    canRetryFailed: false,
    evidenceIncomplete: false,
    ...overrides,
  };
}

const succeededJob = () =>
  job({
    status: "succeeded",
    processedCount: 10,
    appliedCount: 9,
    confirmedCount: 1,
    documentCompleted: 10,
    activeDocumentCount: 0,
    completedAt: "2026-09-14T00:05:00.000Z",
  });

/** What the reader is told about `succeededJob`: the counts are the message. */
const DONE_9_OF_10 = batchActionsCopy.aiCategoryDone({ applied: 9, confirmed: 1, issues: 0 });

/** Asks the page for a run, the way the batch toolbar does after a submit. */
function SubmitProbe({ run }: { run: CategoryAssignmentJob }) {
  const { registerSubmittedJob } = useCategoryAssignment();
  return (
    <button type="button" onClick={() => registerSubmittedJob(run)}>
      submit
    </button>
  );
}

/** `staleTime` is the app's own five minutes when a case depends on it. */
function setup({ staleTime = 0 }: { staleTime?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <CategoryAssignmentProvider>{children}</CategoryAssignmentProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Waits out the poll that reads the run's next state. */
async function poll(queryClient: QueryClient) {
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: ["ledger", "category-assignment"],
    });
  });
}

/** The progress toast appears only once the page has a moving run to describe. */
async function waitForProgressToast() {
  await waitFor(() => expect(toastLoading).toHaveBeenCalled());
}

/** One list row, reading its own entry's state the way the lists do. */
function RowProbe({ entryId }: { entryId: string }) {
  return <p data-testid={`row-${entryId}`}>{useCategoryAssignmentEntryState(entryId) ?? "none"}</p>;
}

describe("CategoryAssignmentProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getJob.mockResolvedValue(null);
    getEntryStates.mockResolvedValue({ jobId: "job-1", pendingIds: [], failedIds: [] });
  });

  it("reports a run this page watched once it ends", async () => {
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitForProgressToast();
    await poll(queryClient);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(DONE_9_OF_10, {}));
    // A statement of the ledger's most recent run is not news a second time.
    await poll(queryClient);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("reports a run the page submitted even when it is already over", async () => {
    getJob.mockResolvedValue(null);
    const { wrapper } = setup();
    render(<SubmitProbe run={succeededJob()} />, { wrapper });
    await waitFor(() => expect(getJob).toHaveBeenCalled());

    fireEvent.click(screen.getByText("submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(DONE_9_OF_10, {}));
  });

  it("stays quiet about a run that ended before this page opened", async () => {
    getJob.mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={succeededJob()} />, { wrapper });

    await waitFor(() => expect(getJob).toHaveBeenCalled());
    await poll(queryClient);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("does not report a run the reader stopped", async () => {
    const cancelled = job({
      status: "cancelled",
      processedCount: 2,
      cancelledCount: 8,
      completedAt: "2026-09-14T00:02:00.000Z",
    });
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(cancelled);
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitForProgressToast();
    await poll(queryClient);

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("carries a moving run's progress and its Stop control in one toast that stays open", async () => {
    getJob.mockResolvedValue(job());
    const { wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitForProgressToast();

    expect(toastLoading).toHaveBeenLastCalledWith(
      batchActionsCopy.categoryJobProgress({ processed: 4, total: 10, active: 2 }),
      expect.objectContaining({
        duration: Infinity,
        dismissible: false,
        action: expect.objectContaining({ label: batchActionsCopy.categoryStop }),
      })
    );
  });

  it("takes the progress toast down once the run ends", async () => {
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(succeededJob());
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });
    await waitForProgressToast();

    await poll(queryClient);

    await waitFor(() => expect(toastDismiss).toHaveBeenCalledWith("category-assignment-progress"));
  });

  it("offers the results when a run ends with entries that need a look", async () => {
    const partial = job({
      status: "partial",
      processedCount: 10,
      appliedCount: 7,
      confirmedCount: 1,
      failedCount: 2,
      completedAt: "2026-09-14T00:05:00.000Z",
    });
    getJob.mockResolvedValueOnce(job()).mockResolvedValue(partial);
    const { queryClient, wrapper } = setup();
    render(<SubmitProbe run={job()} />, { wrapper });
    await waitForProgressToast();

    await poll(queryClient);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        batchActionsCopy.aiCategoryFailed,
        expect.objectContaining({
          action: expect.objectContaining({ label: batchActionsCopy.categoryViewResults }),
        })
      )
    );
  });

  it("marks the rows a moving run is working on, and clears them when it ends", async () => {
    getJob.mockResolvedValue(job());
    getEntryStates.mockResolvedValue({ jobId: "job-1", pendingIds: ["e1"], failedIds: [] });
    const { queryClient, wrapper } = setup();
    render(
      <>
        <RowProbe entryId="e1" />
        <RowProbe entryId="e2" />
      </>,
      { wrapper }
    );

    await waitFor(() => expect(screen.getByTestId("row-e1").textContent).toBe("pending"));
    expect(screen.getByTestId("row-e2").textContent).toBe("none");

    getJob.mockResolvedValue(succeededJob());
    await poll(queryClient);

    await waitFor(() => expect(screen.getByTestId("row-e1").textContent).toBe("none"));
  });

  it("marks the rows a finished run failed", async () => {
    const partial = job({
      status: "partial",
      processedCount: 10,
      failedCount: 1,
      completedAt: "2026-09-14T00:05:00.000Z",
    });
    getJob.mockResolvedValue(job());
    getEntryStates.mockResolvedValue({ jobId: "job-1", pendingIds: ["e1"], failedIds: [] });
    const { queryClient, wrapper } = setup();
    render(<RowProbe entryId="e1" />, { wrapper });
    await waitFor(() => expect(screen.getByTestId("row-e1").textContent).toBe("pending"));

    getJob.mockResolvedValue(partial);
    getEntryStates.mockResolvedValue({ jobId: "job-1", pendingIds: [], failedIds: ["e1"] });
    await poll(queryClient);

    await waitFor(() => expect(screen.getByTestId("row-e1").textContent).toBe("failed"));
  });

  it("hands its readers the same value when it re-renders with nothing new", async () => {
    const seen: unknown[] = [];
    function ValueProbe() {
      seen.push(useCategoryAssignment());
      return null;
    }
    const { queryClient, wrapper } = setup();
    const { rerender } = render(<ValueProbe />, { wrapper });
    await poll(queryClient);
    const settled = seen.at(-1);

    // The workspace above re-renders it with new children on every change of its own.
    rerender(<ValueProbe />);

    expect(seen.at(-1)).toBe(settled);
  });

  it("keeps its readers' value when a finished run loads after the page", async () => {
    getJob.mockResolvedValue(succeededJob());
    const seen: unknown[] = [];
    function ValueProbe() {
      seen.push(useCategoryAssignment());
      return null;
    }
    const { queryClient, wrapper } = setup();
    render(<ValueProbe />, { wrapper });
    const first = seen[0];

    await poll(queryClient);
    // React Query tells its observers on a later tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(queryClient.getQueryData(["ledger", "category-assignment"])).not.toBeNull();
    expect(seen.at(-1)).toBe(first);
  });

  it("reads a run the layout hydrated once more on arrival, keeping its readers' value", async () => {
    // The same run again, as a fresh object from the network.
    getJob.mockImplementation(async () => job());
    const seen: unknown[] = [];
    function ValueProbe() {
      seen.push(useCategoryAssignment());
      return null;
    }
    // Under the app's five-minute staleTime the hydrated run is fresh, so only
    // the hook's own setting makes the page ask again.
    const { queryClient, wrapper } = setup({ staleTime: 5 * 60 * 1000 });
    queryClient.setQueryData(["ledger", "category-assignment"], job());
    render(<ValueProbe />, { wrapper });
    const first = seen[0];

    await waitFor(() => expect(getJob).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(first).toMatchObject({ isActive: true });
    expect(seen.at(-1)).toBe(first);
  });

  it("still asks on arrival when the layout hydrated that there is no run", async () => {
    // This read is what restarts a run whose worker died, so a fresh "none"
    // from the server must not stand in for it.
    const { queryClient, wrapper } = setup({ staleTime: 5 * 60 * 1000 });
    queryClient.setQueryData(["ledger", "category-assignment"], null);
    render(<SubmitProbe run={job()} />, { wrapper });

    await waitFor(() => expect(getJob).toHaveBeenCalledOnce());
  });

  it("refuses to be read outside the provider", () => {
    function Outside() {
      useCategoryAssignment();
      return null;
    }
    expect(() => render(<Outside />)).toThrow(/CategoryAssignmentProvider/);
  });
});
