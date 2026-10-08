"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LEDGER, QUERY } from "@/lib/constants";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { openLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import { queryKeys } from "@/lib/query-keys";
import { useSelection } from "@/hooks/use-selection";
import type { BookDto, LedgerEntry } from "@/modules/ledger/contracts";
import { fetchBook } from "@/modules/ledger/queries";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  createLedgerEntryAction,
  deleteLedgerEntryAction,
} from "@/modules/ledger/server-actions/entries";
import type {
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
  ApplyDuplicateSuggestionResultDto,
  PartialBatchCommandResult,
  SourceDocument,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import type { AddEntryData, DocumentPatch } from "@/modules/source-document/detail-types";
import { fetchSourceDocumentDetail } from "@/modules/source-document/queries";
import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";
import {
  applyDateOrganizationAction,
  dismissDateOrganizationAction,
} from "@/modules/source-document/server-actions/date-organization";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import {
  applyDuplicateSuggestionAction,
  dismissDuplicateSuggestionAction,
} from "@/modules/source-document/server-actions/duplicate-suggestion";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { splitSourceDocumentAction } from "@/modules/source-document/server-actions/split";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import type { EntryEditData } from "@/modules/source-document/types";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy, sourceDocumentDetailCopy } from "@/copy/source-document";

const NO_ENTRIES: LedgerEntry[] = [];

type BatchPatch = { categoryId: string | null } | { currency: string };

/** Values being written, shown in place of the saved ones until the write settles. */
interface PendingWrites {
  document: DocumentPatch;
  entries: Record<string, Partial<EntryEditData>>;
}

const NO_PENDING_WRITES: PendingWrites = { document: {}, entries: {} };

function withoutKeys<T extends object>(value: T, keys: readonly string[]): T {
  const next = { ...value } as Record<string, unknown>;
  for (const key of keys) delete next[key];
  return next as T;
}

/** The fields of a patch that differ from what is saved. */
function changedFields<T extends object>(saved: T, patch: Partial<T>): Partial<T> {
  const changed: Partial<T> = {};
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (value !== saved[key]) changed[key] = value;
  }
  return changed;
}

interface UseSourceDocumentDetailOptions {
  id: string;
  open: boolean;
  /** The live books, to name the record's own book when it has been archived. */
  books: readonly BookDto[];
  onClose: () => void;
}

/**
 * Everything the record sheet does: it reads the record and writes each field
 * the moment it is changed. There is no edit mode and no whole save; the value
 * being written shows in place until the write settles, and a failed write
 * reads the record again.
 */
export function useSourceDocumentDetail({
  id,
  open,
  books,
  onClose,
}: UseSourceDocumentDetailOptions) {
  const queryClient = useQueryClient();

  // --- The record -----------------------------------------------------------

  const detailKey = queryKeys.sourceDocument(id);
  const query = useQuery({
    queryKey: detailKey,
    queryFn: () => fetchSourceDocumentDetail(id),
    enabled: open && id !== "",
    staleTime: QUERY.SOURCE_DOC_STALE_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const sourceDocument = query.data ?? null;
  const savedEntries = sourceDocument?.ledgerEntries ?? NO_ENTRIES;

  // A record whose book was archived after it was filed is not in the live list,
  // so the picker resolves it separately rather than rendering blank. The query
  // only runs in that case.
  const recordBookId = sourceDocument?.bookId ?? null;
  const recordBookIsLive = recordBookId != null && books.some((book) => book.id === recordBookId);
  const { data: archivedRecordBook } = useQuery({
    queryKey: queryKeys.book(recordBookId ?? ""),
    queryFn: () => fetchBook(recordBookId!),
    enabled: open && recordBookId != null && !recordBookIsLive,
    staleTime: LEDGER.STALE_TIME_MS,
  });

  const [pending, setPending] = useState<PendingWrites>(NO_PENDING_WRITES);
  const selection = useSelection({ allIds: savedEntries.map((entry) => entry.id) });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);
  const [isEditRetrying, setIsEditRetrying] = useState(false);

  // --- Commands -------------------------------------------------------------

  /**
   * Writes a command's committed record into the detail cache, cancelling any
   * read in flight so an older answer cannot land on top of it.
   */
  const commitDetailSnapshot = async (document: SourceDocument) => {
    await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
    queryClient.setQueryData<SourceDocument>(detailKey, {
      ...document,
      hasImages: document.hasImages ?? false,
      ledgerEntries: document.ledgerEntries ?? [],
    });
  };

  const documentMutation = useLedgerMutation<unknown, DocumentPatch>({
    mutationFn: (data) => batchUpdateSourceDocumentsAction({ sourceDocumentIds: [id], data }),
    waitFor: detailKey,
  });
  const entryMutation = useLedgerMutation<
    unknown,
    { entryId: string; patch: Partial<EntryEditData> }
  >({
    mutationFn: ({ entryId, patch }) => batchUpdateLedgerEntriesAction([id], [entryId], patch),
    waitFor: detailKey,
  });
  const splitMutation = useLedgerMutation<
    SplitSourceDocumentResultDto,
    Omit<SplitSourceDocumentInput, "sourceDocumentId">
  >({
    waitFor: false,
    mutationFn: (input) => splitSourceDocumentAction({ sourceDocumentId: id, ...input }),
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const dateOrganizationMutation = useLedgerMutation<
    ApplyDateOrganizationResultDto,
    Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  >({
    mutationFn: (input) => applyDateOrganizationAction({ sourceDocumentId: id, ...input }),
    waitFor: detailKey,
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const dismissDateOrganizationMutation = useLedgerMutation<{ dismissed: true }, string>({
    mutationFn: (suggestionId) =>
      dismissDateOrganizationAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
  });
  const applyDuplicateMutation = useLedgerMutation<ApplyDuplicateSuggestionResultDto, string>({
    mutationFn: (suggestionId) =>
      applyDuplicateSuggestionAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
    onSuccess: (result) => {
      // A record that held only repeats is gone, so there is nothing left to show.
      if (result.sourceDocument == null) onClose();
      else return commitDetailSnapshot(result.sourceDocument);
    },
  });
  const dismissDuplicateMutation = useLedgerMutation<{ dismissed: true }, string>({
    mutationFn: (suggestionId) =>
      dismissDuplicateSuggestionAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
  });
  const addEntryMutation = useLedgerMutation<{ ledgerEntryId: string }, AddEntryData>({
    mutationFn: (data) => createLedgerEntryAction({ sourceDocumentId: id, ...data }),
    waitFor: detailKey,
  });
  const deleteEntryMutation = useLedgerMutation<{ ledgerEntryId: string; deleted: true }, string>({
    mutationFn: (entryId) => deleteLedgerEntryAction(id, entryId),
    waitFor: detailKey,
  });
  const batchUpdateMutation = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { ids: string[]; patch: BatchPatch }
  >({
    mutationFn: ({ ids, patch }) => batchUpdateLedgerEntriesAction([id], ids, patch),
    waitFor: detailKey,
  });
  const batchDeleteMutation = useLedgerMutation<PartialBatchCommandResult, string[]>({
    mutationFn: (entryIds) => batchDeleteLedgerEntriesAction([id], entryIds),
    waitFor: detailKey,
  });
  const deleteDocumentMutation = useLedgerMutation<unknown, void>({
    waitFor: false,
    mutationFn: () => deleteSourceDocumentAction(id),
    successMessage: commonCopy.deleteSuccess,
    errorMessage: commonCopy.deleteFailed,
    onSuccess: () => {
      setShowDeleteConfirm(false);
      onClose();
    },
  });
  const cancelMutation = useLedgerMutation<unknown, void>({
    mutationFn: () => cancelSourceDocumentProcessingAction(id),
    successMessage: sourceDocumentActionCopy.cancelSuccess,
    errorMessage: sourceDocumentActionCopy.cancelError,
  });
  const retryMutation = useLedgerMutation<unknown, void>({
    mutationFn: () => retrySourceDocumentAction(id),
    waitFor: detailKey,
    successMessage: sourceDocumentActionCopy.retrySuccess,
    errorMessage: sourceDocumentActionCopy.retryError,
  });
  const assignBookMutation = useLedgerMutation({
    // An archived target says so instead of snapping the picker back silently.
    errorMessage: commonCopy.bookChangeFailed,
    mutationFn: (bookId: string) =>
      assignSourceDocumentBookAction({ sourceDocumentId: id, bookId }),
    waitFor: detailKey,
  });

  // --- State the sheet reads --------------------------------------------------

  const isProcessing = sourceDocument?.supportedActions.includes("cancel_processing") === true;
  const busy =
    deleteDocumentMutation.isPending ||
    splitMutation.isPending ||
    batchUpdateMutation.isPending ||
    batchDeleteMutation.isPending ||
    retryMutation.isPending ||
    cancelMutation.isPending ||
    isEditRetrying;
  // Fields are written one at a time: nothing is editable while the record is
  // being processed, since the run replaces its entries when it finishes.
  const readOnly = sourceDocument == null || isProcessing || busy;
  const title = pending.document.title ?? sourceDocument?.title ?? "";
  const documentDate = pending.document.documentDate ?? sourceDocument?.documentDate ?? "";

  // --- Field writes ---------------------------------------------------------

  /**
   * A failed write reads the record again, so what is shown is what is saved.
   * An entry that is no longer there was replaced by a run, and the reader is
   * told the record changed rather than that their edit failed.
   */
  const reportFailedWrite = async (entryId?: string) => {
    const result = await query.refetch();
    const entryGone =
      entryId != null &&
      result.data != null &&
      !result.data.ledgerEntries.some((entry) => entry.id === entryId);
    toast.error(entryGone ? sourceDocumentDetailCopy.entryReplaced : commonCopy.saveFailed);
  };

  const updateDocument = async (patch: DocumentPatch) => {
    if (sourceDocument == null || readOnly) return;
    const changed = changedFields<DocumentPatch>(
      { title: sourceDocument.title ?? "", documentDate: sourceDocument.documentDate },
      patch
    );
    if (changed.title !== undefined && changed.title.trim() === "") return;
    const keys = Object.keys(changed);
    if (keys.length === 0) return;
    setPending((current) => ({ ...current, document: { ...current.document, ...changed } }));
    try {
      await documentMutation.mutateAsync(changed);
    } catch {
      await reportFailedWrite();
    } finally {
      setPending((current) => ({ ...current, document: withoutKeys(current.document, keys) }));
    }
  };

  const updateEntry = async (entryId: string, patch: Partial<EntryEditData>) => {
    const saved = savedEntries.find((entry) => entry.id === entryId);
    if (saved == null || readOnly || pending.entries[entryId] != null) return;
    const changed = changedFields<EntryEditData>(
      {
        itemName: saved.itemName,
        amount: saved.amount,
        currency: saved.currency ?? "",
        categoryId: saved.categoryId,
        description: saved.description,
      },
      patch
    );
    if (changed.itemName !== undefined && changed.itemName.trim() === "") return;
    if (Object.keys(changed).length === 0) return;
    setPending((current) => ({ ...current, entries: { ...current.entries, [entryId]: changed } }));
    try {
      await entryMutation.mutateAsync({ entryId, patch: changed });
    } catch {
      await reportFailedWrite(entryId);
    } finally {
      setPending((current) => ({ ...current, entries: withoutKeys(current.entries, [entryId]) }));
    }
  };

  // --- Batch selection ------------------------------------------------------

  const toggleSelectionMode = () => {
    if (readOnly || savedEntries.length === 0) return;
    selection.setSelectionMode(!selection.isSelectionMode);
  };

  const batchPatch = async (patch: BatchPatch) => {
    if (selection.selectedIds.length === 0 || busy) return;
    try {
      const result = await batchUpdateMutation.mutateAsync({ ids: selection.selectedIds, patch });
      if (result.affectedCount > 0) {
        toast.success(sourceDocumentDetailCopy.batchUpdateSuccess({ count: result.affectedCount }));
      }
      selection.clearSelection();
    } catch {
      toast.error(sourceDocumentDetailCopy.batchUpdateError);
    }
  };

  const batchDelete = async () => {
    if (busy) return false;
    try {
      const result = await batchDeleteMutation.mutateAsync(selection.selectedIds);
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) selection.clearSelection();
      else selection.retainSelection(unresolved);
      if (result.succeeded.length > 0) {
        toast.success(
          sourceDocumentDetailCopy.batchDeleteSuccess({ count: result.succeeded.length })
        );
      }
      if (unresolved.length > 0) {
        toast.error(sourceDocumentDetailCopy.batchDeletePartial({ count: unresolved.length }));
        return false;
      }
      setShowBatchDeleteConfirm(false);
      return true;
    } catch {
      toast.error(sourceDocumentDetailCopy.batchDeleteError);
      return false;
    }
  };

  // --- Entries and the record -----------------------------------------------

  const feedbackToastId = `source-document-entry:${id}`;

  const openSplit = () => {
    if (busy || selection.selectedIds.length === 0) return;
    if (selection.selectedIds.length >= savedEntries.length) {
      toast.error(sourceDocumentDetailCopy.splitKeepOne);
      return;
    }
    setShowSplitDialog(true);
  };

  const split = async (entryDate: string) => {
    if (busy) return;
    try {
      const result = await splitMutation.mutateAsync({
        ledgerEntryIds: selection.selectedIds,
        entryDate,
      });
      setShowSplitDialog(false);
      selection.clearSelection();
      toast.success(sourceDocumentDetailCopy.splitSuccess({ count: result.movedEntryCount }), {
        id: feedbackToastId,
        action: {
          label: sourceDocumentDetailCopy.viewSplitBill,
          // The new record replaces this one in the sheet; Back still lands on the list.
          onClick: () => openLedgerDetail(result.splitSourceDocumentId),
        },
      });
    } catch {
      toast.error(sourceDocumentDetailCopy.splitFailed);
    }
  };

  const addEntry = async (data: AddEntryData): Promise<boolean> => {
    if (readOnly) return false;
    try {
      await addEntryMutation.mutateAsync(data);
      toast.success(sourceDocumentDetailCopy.addEntrySuccess, {
        id: feedbackToastId,
        action: null,
      });
      return true;
    } catch {
      toast.error(sourceDocumentDetailCopy.addEntryError);
      return false;
    }
  };

  const deleteEntry = async (entryId: string): Promise<boolean> => {
    if (readOnly) return false;
    try {
      await deleteEntryMutation.mutateAsync(entryId);
      setPendingDeleteEntryId(null);
      toast.success(commonCopy.deleteSuccess, { id: feedbackToastId, action: null });
      return true;
    } catch {
      toast.error(commonCopy.deleteFailed);
      return false;
    }
  };

  const deleteDocument = async () => {
    if (sourceDocument == null || busy) return;
    try {
      await deleteDocumentMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    }
  };

  // A cancel can be tapped twice before its pending state renders.
  const cancelLockRef = useRef(false);
  const cancelProcessing = async () => {
    if (cancelLockRef.current || busy) return;
    cancelLockRef.current = true;
    try {
      await cancelMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    } finally {
      cancelLockRef.current = false;
    }
  };

  const retry = async () => {
    if (busy) return;
    try {
      await retryMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    }
  };

  return {
    sourceDocument,
    /** The saved entries; the values being written are in `pendingEntries`. */
    ledgerEntries: savedEntries,
    pendingEntries: pending.entries,
    title,
    documentDate,
    isLoading: query.isLoading,
    loadError: query.error != null,
    isReloading: query.isRefetching,
    reload: () => void query.refetch(),
    archivedBookLabel:
      archivedRecordBook == null
        ? null
        : commonCopy.archivedBookOption({ name: archivedRecordBook.name }),
    isAssigningBook: assignBookMutation.isPending,
    assignBook: (bookId: string) => {
      if (!readOnly && bookId !== sourceDocument?.bookId) assignBookMutation.mutate(bookId);
    },
    applyDateOrganization: dateOrganizationMutation.mutateAsync,
    dismissDateOrganization: dismissDateOrganizationMutation.mutateAsync,
    isOrganizingDates:
      dateOrganizationMutation.isPending || dismissDateOrganizationMutation.isPending,
    applyDuplicateSuggestion: applyDuplicateMutation.mutateAsync,
    dismissDuplicateSuggestion: dismissDuplicateMutation.mutateAsync,
    isResolvingDuplicates: applyDuplicateMutation.isPending || dismissDuplicateMutation.isPending,
    selection,
    status: {
      busy,
      readOnly,
      isProcessing,
      /** Whether the record's title or date is being written. */
      isSavingDocument: Object.keys(pending.document).length > 0,
      /** The entries being written; each such row waits for its write to settle. */
      savingEntryIds: Object.keys(pending.entries),
      isBatchUpdating: batchUpdateMutation.isPending,
      isSplitting: splitMutation.isPending,
      isAddingEntry: addEntryMutation.isPending,
      isCancelling: cancelMutation.isPending,
      isRetrying: retryMutation.isPending,
      setIsEditRetrying,
    },
    dialogs: {
      showDeleteConfirm,
      setShowDeleteConfirm,
      showBatchDeleteConfirm,
      setShowBatchDeleteConfirm,
      showRetryDialog,
      setShowRetryDialog,
      showSplitDialog,
      setShowSplitDialog,
      showAddEntryDialog,
      setShowAddEntryDialog,
      pendingDeleteEntryId,
      setPendingDeleteEntryId,
    },
    actions: {
      updateDocument,
      updateEntry,
      toggleSelectionMode,
      batchCategory: (categoryId: string | null) => batchPatch({ categoryId }),
      batchCurrency: (currency: string) => batchPatch({ currency }),
      openBatchDelete: () => !busy && setShowBatchDeleteConfirm(true),
      batchDelete,
      openSplit,
      split,
      openAddEntry: () => !readOnly && setShowAddEntryDialog(true),
      addEntry,
      requestDeleteEntry: (entryId: string) => !readOnly && setPendingDeleteEntryId(entryId),
      deleteEntry,
      requestDeleteDocument: () => !busy && setShowDeleteConfirm(true),
      deleteDocument,
      cancelProcessing,
      retry,
      openEditRetry: () => !busy && setShowRetryDialog(true),
    },
  };
}
