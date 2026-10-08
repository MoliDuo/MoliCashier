import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy, sourceDocumentDetailCopy } from "@/copy/source-document";
import { queryKeys } from "@/lib/query-keys";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import type { EntryEditData } from "@/modules/source-document/types";
import { SourceDocumentDetailModal } from "@/modules/source-document/ui/SourceDocumentDetailModal";

const {
  toastErrorMock,
  fetchDetailMock,
  updateDocumentMock,
  updateEntriesMock,
  splitMock,
  deleteMock,
  cancelMock,
  retryMock,
  editRetryDialogMock,
} = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  fetchDetailMock: vi.fn(),
  updateDocumentMock: vi.fn(),
  updateEntriesMock: vi.fn(),
  splitMock: vi.fn(),
  deleteMock: vi.fn(),
  cancelMock: vi.fn(),
  retryMock: vi.fn(),
  editRetryDialogMock: vi.fn(),
}));

vi.mock("@/modules/source-document/queries", () => ({
  fetchSourceDocumentDetail: fetchDetailMock,
}));
vi.mock("@/modules/ledger/queries", () => ({ fetchBook: vi.fn() }));
vi.mock("@/lib/mutations/ledger-sync", () => ({
  syncLedgerAfterWrite: () => Promise.resolve(),
}));
vi.mock("@/modules/source-document/server-actions/update", () => ({
  batchUpdateSourceDocumentsAction: updateDocumentMock,
}));
vi.mock("@/modules/source-document/server-actions/split", () => ({
  splitSourceDocumentAction: splitMock,
}));
vi.mock("@/modules/source-document/server-actions/delete", () => ({
  deleteSourceDocumentAction: deleteMock,
}));
vi.mock("@/modules/source-document/server-actions/processing", () => ({
  cancelSourceDocumentProcessingAction: cancelMock,
}));
vi.mock("@/modules/source-document/server-actions/retry", () => ({
  retrySourceDocumentAction: retryMock,
}));
vi.mock("@/modules/source-document/server-actions/book", () => ({
  assignSourceDocumentBookAction: vi.fn(),
}));
vi.mock("@/modules/source-document/server-actions/date-organization", () => ({
  applyDateOrganizationAction: vi.fn(),
  dismissDateOrganizationAction: vi.fn(),
}));
vi.mock("@/modules/ledger/server-actions/entries", () => ({
  createLedgerEntryAction: vi.fn(),
  deleteLedgerEntryAction: vi.fn(),
  batchUpdateLedgerEntriesAction: updateEntriesMock,
  batchDeleteLedgerEntriesAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastErrorMock, warning: vi.fn() },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      {children}
      <button onClick={() => onOpenChange?.(false)}>dialog-close</button>
    </div>
  ),
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// The menu's items are always rendered, so each command is one click away.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button role="menuitem" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    title,
    onConfirm,
  }: {
    open?: boolean;
    title: string;
    onConfirm?: () => void | Promise<void | boolean>;
  }) =>
    open ? (
      <div>
        <span>{title}</span>
        {/* The real dialog keeps itself open when its action throws. */}
        <button onClick={() => void Promise.resolve(onConfirm?.()).catch(() => {})}>confirm</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/editable-field", () => ({
  EditableField: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <span>{`title: ${value}`}</span>
      <button disabled={disabled} onClick={() => onChange("Dinner receipt")}>
        rename
      </button>
      <button disabled={disabled} onClick={() => onChange(value)}>
        rename-unchanged
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/date-filter", () => ({
  DateFilter: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (date: Date | null) => void;
    readOnly?: boolean;
  }) => (
    <button disabled={readOnly} onClick={() => onChange(new Date(2026, 7, 2))}>
      {`date: ${value}`}
    </button>
  ),
}));

vi.mock("@/modules/source-document/ui/SourceDocumentViewDetails", () => ({
  SourceDocumentViewDetails: ({
    isSelectionMode,
    readOnly,
    pendingEntries,
    savingEntryIds,
    onEntryChange,
    onToggleSelectionMode,
    onSelectEntry,
    onDeleteEntry,
    selectionToolbar,
  }: {
    isSelectionMode: boolean;
    readOnly: boolean;
    pendingEntries: Record<string, Partial<EntryEditData>>;
    savingEntryIds: readonly string[];
    onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
    onToggleSelectionMode: () => void;
    onSelectEntry: (entryId: string, selected: boolean) => void;
    onDeleteEntry: (entryId: string) => void;
    selectionToolbar?: ReactNode;
  }) => (
    <div>
      {/* The real pane renders the band in the entries card's header row. */}
      {selectionToolbar}
      <span>{readOnly ? "read-only" : "editable"}</span>
      <span>{isSelectionMode ? "selecting" : "not-selecting"}</span>
      <span>{`pending: ${pendingEntries["entry-1"]?.itemName ?? "none"}`}</span>
      <span>{`saving: ${savingEntryIds.join(",") || "none"}`}</span>
      <button onClick={() => onEntryChange("entry-1", { itemName: "Brunch" })}>rename-entry</button>
      <button onClick={() => onEntryChange("entry-1", { itemName: "Lunch" })}>
        rename-entry-unchanged
      </button>
      <button onClick={onToggleSelectionMode}>batch-toggle</button>
      <button onClick={() => onSelectEntry("entry-1", true)}>select-first</button>
      <button onClick={() => onDeleteEntry("entry-1")}>delete-entry</button>
    </div>
  ),
}));

vi.mock("@/modules/ledger/ui/batch-action-toolbar", () => ({
  LedgerEntriesBatchActionToolbar: ({ onSplit }: { onSplit?: () => void }) => (
    <div>
      batch-toolbar
      {onSplit != null ? <button onClick={onSplit}>open-split</button> : null}
    </div>
  ),
}));

vi.mock("@/modules/source-document/ui/SourceDocumentEditRetryDialog", () => ({
  SourceDocumentEditRetryDialog: ({ open }: { open: boolean }) => {
    editRetryDialogMock(open);
    return open ? <div>edit-retry-dialog</div> : null;
  },
}));
vi.mock("@/modules/source-document/ui/AddLedgerEntryDialog", () => ({
  AddLedgerEntryDialog: () => null,
}));
vi.mock("@/modules/source-document/ui/SourceDocumentSplitDialog", () => ({
  SourceDocumentSplitDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (documentDate: string) => Promise<void>;
  }) => (open ? <button onClick={() => void onSubmit("2026-09-03")}>submit-split</button> : null),
}));
vi.mock("@/lib/navigation/ledger-detail-navigation", () => ({
  openLedgerDetail: vi.fn(),
}));

const entry: LedgerEntry = {
  id: "entry-1",
  sourceDocumentId: "doc-1",
  categoryId: null,
  amount: "12.00",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.00",
  exchangeRate: "1",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const secondEntry: LedgerEntry = {
  ...entry,
  id: "entry-2",
  itemName: "Dinner",
  amount: "18.00",
  convertedAmount: "18.00",
};

const sourceDocument: SourceDocument = {
  id: "doc-1",
  version: 1,
  latestAttemptId: null,
  title: "Receipt",
  text: null,
  files: [],
  processingStatus: "completed",
  failureKind: null,
  failureMessage: null,
  documentDate: "2026-07-28",
  createdAt: "2026-07-28T00:00:00.000Z",
  hasImages: false,
  ledgerEntries: [entry],
  updatedAt: "2026-07-28T00:00:00.000Z",
  supportedActions: ["split_entries", "delete"],
  canEdit: true,
  errorCode: null,
};

const detailKey = queryKeys.sourceDocument("doc-1");

let client: QueryClient;

function newClient(document: SourceDocument | null = sourceDocument) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (document != null) client.setQueryData(queryKeys.sourceDocument(document.id), document);
  return client;
}

function modal(onClose: () => void = vi.fn()) {
  return (
    <QueryClientProvider client={client}>
      <SourceDocumentDetailModal
        books={[]}
        id="doc-1"
        categories={[]}
        mainCurrency="CNY"
        preferredCurrencies={[]}
        open
        onClose={onClose}
      />
    </QueryClientProvider>
  );
}

function renderModal(
  document: SourceDocument | null = sourceDocument,
  onClose: () => void = vi.fn()
) {
  newClient(document);
  return render(modal(onClose));
}

/** A promise the test settles by hand, to look at the sheet mid-write. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("SourceDocumentDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchDetailMock.mockResolvedValue(sourceDocument);
    updateDocumentMock.mockResolvedValue({ sourceDocumentIds: ["doc-1"], updatedCount: 1 });
    updateEntriesMock.mockResolvedValue({ ledgerEntryIds: ["entry-1"], affectedCount: 1 });
  });

  it("loads the record it is opened on", async () => {
    newClient(null);
    render(modal());
    await waitFor(() => expect(screen.getByText("editable")).toBeInTheDocument());
    expect(fetchDetailMock).toHaveBeenCalledExactlyOnceWith("doc-1", {
      signal: expect.any(AbortSignal),
    });
  });

  it("writes a new title at once and shows it until the record reads back", async () => {
    const write = deferred<unknown>();
    updateDocumentMock.mockReturnValue(write.promise);
    fetchDetailMock.mockResolvedValue({ ...sourceDocument, title: "Dinner receipt" });
    renderModal();

    fireEvent.click(screen.getByText("rename"));

    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith({
        sourceDocumentIds: ["doc-1"],
        data: { title: "Dinner receipt" },
      })
    );
    expect(screen.getByText("title: Dinner receipt")).toBeInTheDocument();
    await act(async () => write.resolve({ updatedCount: 1 }));
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalled());
    expect(screen.getByText("title: Dinner receipt")).toBeInTheDocument();
  });

  it("writes nothing for a title left as it was", () => {
    renderModal();
    fireEvent.click(screen.getByText("rename-unchanged"));
    expect(updateDocumentMock).not.toHaveBeenCalled();
  });

  it("writes a new date at once", async () => {
    renderModal();
    fireEvent.click(screen.getByText("date: 2026-07-28"));
    await waitFor(() =>
      expect(updateDocumentMock).toHaveBeenCalledWith({
        sourceDocumentIds: ["doc-1"],
        data: { documentDate: "2026-08-02" },
      })
    );
  });

  it("writes one entry field on its own and holds that row until it settles", async () => {
    const write = deferred<unknown>();
    updateEntriesMock.mockReturnValue(write.promise);
    renderModal();

    fireEvent.click(screen.getByText("rename-entry"));

    await waitFor(() =>
      expect(updateEntriesMock).toHaveBeenCalledWith(["doc-1"], ["entry-1"], {
        itemName: "Brunch",
      })
    );
    expect(screen.getByText("pending: Brunch")).toBeInTheDocument();
    expect(screen.getByText("saving: entry-1")).toBeInTheDocument();
    await act(async () => write.resolve({ ledgerEntryIds: ["entry-1"], affectedCount: 1 }));
    await waitFor(() => expect(screen.getByText("saving: none")).toBeInTheDocument());
    expect(screen.getByText("pending: none")).toBeInTheDocument();
  });

  it("writes nothing for an entry field left as it was", () => {
    renderModal();
    fireEvent.click(screen.getByText("rename-entry-unchanged"));
    expect(updateEntriesMock).not.toHaveBeenCalled();
  });

  it("reads the record again and says so when an entry write fails", async () => {
    updateEntriesMock.mockRejectedValue(new Error("boom"));
    renderModal();

    fireEvent.click(screen.getByText("rename-entry"));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(commonCopy.saveFailed));
    expect(fetchDetailMock).toHaveBeenCalled();
    expect(screen.getByText("pending: none")).toBeInTheDocument();
  });

  it("names a record whose entry a run replaced, rather than a failed save", async () => {
    updateEntriesMock.mockRejectedValue(new Error("Active ledger entry projection not found"));
    fetchDetailMock.mockResolvedValue({ ...sourceDocument, ledgerEntries: [secondEntry] });
    renderModal();

    fireEvent.click(screen.getByText("rename-entry"));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(sourceDocumentDetailCopy.entryReplaced)
    );
  });

  it("keeps a processing record read-only and says why", () => {
    renderModal({
      ...sourceDocument,
      processingStatus: "processing",
      supportedActions: ["cancel_processing", "retry", "edit_retry", "delete"],
    });

    expect(screen.getByText(sourceDocumentDetailCopy.processingReadOnly)).toBeInTheDocument();
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(screen.getByText("rename")).toBeDisabled();
    fireEvent.click(screen.getByText("rename-entry"));
    expect(updateEntriesMock).not.toHaveBeenCalled();
  });

  it("enters and leaves selection mode directly", () => {
    renderModal();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("selecting")).toBeInTheDocument();
    expect(screen.getByText("batch-toolbar")).toBeInTheDocument();
    fireEvent.click(screen.getByText("batch-toggle"));
    expect(screen.getByText("not-selecting")).toBeInTheDocument();
  });

  it("offers the record's commands in its menu", async () => {
    const retryable: SourceDocument = {
      ...sourceDocument,
      supportedActions: ["split_entries", "retry", "edit_retry", "delete"],
    };
    retryMock.mockResolvedValue({});
    fetchDetailMock.mockResolvedValue(retryable);
    renderModal(retryable);

    fireEvent.click(screen.getByRole("menuitem", { name: sourceDocumentActionCopy.retry }));
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith("doc-1"));

    fireEvent.click(screen.getByRole("menuitem", { name: sourceDocumentActionCopy.editRetry }));
    expect(screen.getByText("edit-retry-dialog")).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: sourceDocumentActionCopy.cancelProcessing })
    ).not.toBeInTheDocument();
  });

  it("shows a pending indicator while processing is cancelled", async () => {
    cancelMock.mockReturnValue(new Promise(() => {}));
    renderModal({ ...sourceDocument, supportedActions: ["cancel_processing", "delete"] });

    fireEvent.click(
      screen.getByRole("menuitem", { name: sourceDocumentActionCopy.cancelProcessing })
    );

    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: sourceDocumentActionCopy.cancelProcessing })
      ).toBeDisabled()
    );
    expect(cancelMock).toHaveBeenCalledWith("doc-1");
  });

  it("keeps the sheet open when deleting the record fails", async () => {
    deleteMock.mockRejectedValue(new Error("Source document not found"));
    const onClose = vi.fn();
    renderModal(sourceDocument, onClose);

    fireEvent.click(
      screen.getByRole("menuitem", { name: sourceDocumentDetailCopy.deleteDocument })
    );
    fireEvent.click(screen.getByText("confirm"));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(commonCopy.deleteFailed));
    expect(deleteMock).toHaveBeenCalledWith("doc-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the sheet once the record is deleted", async () => {
    deleteMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal(sourceDocument, onClose);

    fireEvent.click(
      screen.getByRole("menuitem", { name: sourceDocumentDetailCopy.deleteDocument })
    );
    fireEvent.click(screen.getByText("confirm"));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("confirms before deleting one entry", () => {
    renderModal();
    fireEvent.click(screen.getByText("delete-entry"));
    expect(screen.getByText(sourceDocumentDetailCopy.deleteEntryTitle)).toBeInTheDocument();
  });

  it("retries split with only the selected entries and date, then installs the snapshot", async () => {
    splitMock.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValueOnce({
      splitSourceDocumentId: "doc-2",
      splitVersion: 1,
      movedEntryCount: 1,
      sourceDocument: { ...sourceDocument, version: 2, ledgerEntries: [secondEntry] },
    });
    renderModal({ ...sourceDocument, ledgerEntries: [entry, secondEntry] });
    fireEvent.click(screen.getByText("batch-toggle"));
    fireEvent.click(screen.getByText("select-first"));
    fireEvent.click(screen.getByText("open-split"));

    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(splitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("submit-split")).toBeInTheDocument());
    fireEvent.click(screen.getByText("submit-split"));
    await waitFor(() => expect(splitMock).toHaveBeenCalledTimes(2));

    const firstInput = splitMock.mock.calls[0]![0];
    expect(firstInput).toEqual({
      sourceDocumentId: "doc-1",
      ledgerEntryIds: ["entry-1"],
      entryDate: "2026-09-03",
    });
    expect(splitMock.mock.calls[1]![0]).toEqual(firstInput);
    await waitFor(() => expect(screen.queryByText("submit-split")).not.toBeInTheDocument());
    expect(client.getQueryData(detailKey)).toMatchObject({
      version: 2,
      ledgerEntries: [{ id: "entry-2" }],
    });
  });
});
