"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEDGER, QUERY } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import { useSelection } from "@/hooks/use-selection";
import type { BookDto, LedgerEntry } from "@/modules/ledger/contracts";
import { fetchBook } from "@/modules/ledger/queries";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import type { AddEntryData, DocumentPatch } from "@/modules/source-document/detail-types";
import { fetchSourceDocumentDetail } from "@/modules/source-document/queries";
import type { EntryEditData } from "@/modules/source-document/types";
import { commonCopy } from "@/copy/common";
import { useSourceDocumentEntryCommands } from "./useSourceDocumentEntryCommands";
import { useSourceDocumentFieldWrites } from "./useSourceDocumentFieldWrites";
import { useSourceDocumentRecordCommands } from "./useSourceDocumentRecordCommands";
import { useSourceDocumentSuggestions } from "./useSourceDocumentSuggestions";

const NO_ENTRIES: LedgerEntry[] = [];

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
 *
 * The writes live in one hook per area (fields, entries, suggestions, the
 * record itself); this one reads the record and decides, from all of them,
 * when the record may be changed.
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
    queryFn: ({ signal }) => fetchSourceDocumentDetail(id, { signal }),
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
    queryFn: ({ signal }) => fetchBook(recordBookId!, { signal }),
    enabled: open && recordBookId != null && !recordBookIsLive,
    staleTime: LEDGER.STALE_TIME_MS,
  });

  const selection = useSelection({ allIds: savedEntries.map((entry) => entry.id) });

  /**
   * Writes a command's committed record into the detail cache, cancelling any
   * read in flight so an older answer cannot land on top of it.
   */
  const commitDetailSnapshot = async (document: SourceDocumentDetailDto) => {
    await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
    queryClient.setQueryData<SourceDocumentDetailDto>(detailKey, {
      ...document,
      hasImages: document.hasImages ?? false,
      ledgerEntries: document.ledgerEntries ?? [],
    });
  };

  const fields = useSourceDocumentFieldWrites({
    id,
    detailKey,
    sourceDocument,
    savedEntries,
    refetch: () => query.refetch(),
  });
  const entries = useSourceDocumentEntryCommands({
    id,
    detailKey,
    savedEntries,
    selection,
    commitDetailSnapshot,
  });
  const suggestions = useSourceDocumentSuggestions({
    id,
    detailKey,
    commitDetailSnapshot,
    onClose,
  });
  const record = useSourceDocumentRecordCommands({ id, detailKey, onClose });

  // --- When the record may change -------------------------------------------

  const isProcessing = sourceDocument?.supportedActions.includes("cancel_processing") === true;
  const busy =
    record.isDeleting ||
    entries.isSplitting ||
    entries.isBatchUpdating ||
    entries.isBatchDeleting ||
    record.isRetrying ||
    record.isCancelling ||
    record.isEditRetrying;
  // Fields are written one at a time: nothing is editable while the record is
  // being processed, since the run replaces its entries when it finishes.
  const readOnly = sourceDocument == null || isProcessing || busy;
  const { pending } = fields;
  const title = pending.document.title ?? sourceDocument?.title ?? "";
  const documentDate = pending.document.documentDate ?? sourceDocument?.documentDate ?? "";

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
    isAssigningBook: record.isAssigningBook,
    assignBook: (bookId: string) => {
      if (!readOnly && bookId !== sourceDocument?.bookId) record.assignBook(bookId);
    },
    applyDateOrganization: suggestions.applyDateOrganization,
    dismissDateOrganization: suggestions.dismissDateOrganization,
    isOrganizingDates: suggestions.isOrganizingDates,
    applyDuplicateSuggestion: suggestions.applyDuplicateSuggestion,
    dismissDuplicateSuggestion: suggestions.dismissDuplicateSuggestion,
    isResolvingDuplicates: suggestions.isResolvingDuplicates,
    selection,
    status: {
      busy,
      readOnly,
      isProcessing,
      /** Whether the record's title or date is being written. */
      isSavingDocument: Object.keys(pending.document).length > 0,
      /** The entries being written; each such row waits for its write to settle. */
      savingEntryIds: Object.keys(pending.entries),
      isBatchUpdating: entries.isBatchUpdating,
      isSplitting: entries.isSplitting,
      isAddingEntry: entries.isAddingEntry,
      isCancelling: record.isCancelling,
      isRetrying: record.isRetrying,
      setIsEditRetrying: record.setIsEditRetrying,
    },
    dialogs: {
      ...record.dialogs,
      ...entries.dialogs,
    },
    actions: {
      updateDocument: async (patch: DocumentPatch) => {
        if (!readOnly) await fields.updateDocument(patch);
      },
      updateEntry: async (entryId: string, patch: Partial<EntryEditData>) => {
        if (!readOnly) await fields.updateEntry(entryId, patch);
      },
      toggleSelectionMode: () => {
        if (readOnly || savedEntries.length === 0) return;
        selection.setSelectionMode(!selection.isSelectionMode);
      },
      batchCategory: async (categoryId: string | null) => {
        if (!busy) await entries.batchPatch({ categoryId });
      },
      batchCurrency: async (currency: string) => {
        if (!busy) await entries.batchPatch({ currency });
      },
      openBatchDelete: () => !busy && entries.dialogs.setShowBatchDeleteConfirm(true),
      batchDelete: async () => (busy ? false : entries.batchDelete()),
      openSplit: () => {
        if (!busy) entries.openSplit();
      },
      split: async (entryDate: string) => {
        if (!busy) await entries.split(entryDate);
      },
      openAddEntry: () => !readOnly && entries.dialogs.setShowAddEntryDialog(true),
      addEntry: async (data: AddEntryData) => (readOnly ? false : entries.addEntry(data)),
      requestDeleteEntry: (entryId: string) =>
        !readOnly && entries.dialogs.setPendingDeleteEntryId(entryId),
      deleteEntry: async (entryId: string) => (readOnly ? false : entries.deleteEntry(entryId)),
      requestDeleteDocument: () => !busy && record.dialogs.setShowDeleteConfirm(true),
      deleteDocument: async () => {
        if (sourceDocument != null && !busy) await record.deleteDocument();
      },
      cancelProcessing: async () => {
        if (!busy) await record.cancelProcessing();
      },
      retry: async () => {
        if (!busy) await record.retry();
      },
      openEditRetry: () => !busy && record.dialogs.setShowRetryDialog(true),
    },
  };
}
