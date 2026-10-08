"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSelection } from "@/hooks/use-selection";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import {
  openLedgerDetail,
  openLedgerEntrySourceDocument,
} from "@/lib/navigation/ledger-detail-navigation";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type {
  BatchUpdateSourceDocumentsResultDto,
  PartialBatchCommandResult,
  SourceDocumentListItemDto,
} from "@/modules/source-document/contracts";
import { fetchStreamPage, fetchStreamTotal } from "@/modules/source-document/queries";
import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import { buildUnifiedStreamGroups } from "@/modules/source-document/stream-grouping";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { periodKey, type Period } from "@/modules/ledger/domain/period";
import { buildLedgerEntryFilters } from "@/modules/workspace/ledger-filter-state";
import { uniquePagedItems } from "@/modules/workspace/paged-items";
import { buildStreamQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { fetchSourceDocumentDateImpact } from "@/modules/workspace/queries";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy } from "@/copy/source-document";
import { batchActionsCopy } from "@/copy/workspace";
import type { SourceDocumentProcessingStatus } from "@/lib/source-document-values";

type StreamPage = Awaited<ReturnType<typeof fetchStreamPage>>;

const ABNORMAL_STATUSES: ReadonlySet<SourceDocumentProcessingStatus | null> = new Set([
  "failed",
  "cancelled",
]);

interface StreamRecoveryVariables {
  sourceDocumentId: string;
}

type RecoveryAction = (variables: StreamRecoveryVariables) => Promise<unknown>;

interface UseLedgerEntriesTabOptions {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  mainCurrency: string;
  period: Period;
  advancedFilters?: LedgerAdvancedFilters | undefined;
}

/**
 * Everything the stream tab does: it pages through the source-document
 * stream and its total, keeps the refresh poll running, and owns batch
 * selection, row recovery and the tab's dialogs.
 */
export function useLedgerEntriesTab({
  bookId,
  mainCurrency,
  period,
  advancedFilters,
}: UseLedgerEntriesTabOptions) {
  const queryClient = useQueryClient();

  // --- The stream -----------------------------------------------------------

  const filters = useMemo(() => buildLedgerEntryFilters(advancedFilters), [advancedFilters]);
  const queryDescriptor = useMemo(
    () =>
      buildStreamQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        period,
        minAmount: filters.minAmount,
        maxAmount: filters.maxAmount,
        statuses: filters.statuses,
        search: filters.search,
        categoryId: filters.categoryId,
        currency: filters.currency,
      }),
    [
      bookId,
      filters.categoryId,
      filters.currency,
      filters.maxAmount,
      filters.minAmount,
      filters.search,
      filters.statuses,
      period,
    ]
  );
  const streamPageKey = queryDescriptor.queryKey;

  // Selecting freezes the list: a background refresh must not swap the rows
  // out from under the selection. The queries read again once it ends.
  const [frozen, setFrozen] = useState(false);

  const totalQuery = useQuery({
    queryKey: queryDescriptor.totalQueryKey,
    enabled: !frozen,
    queryFn: ({ signal }) => fetchStreamTotal(queryDescriptor.totalInput, { signal }),
  });

  const streamQuery = useInfiniteQuery({
    queryKey: streamPageKey,
    enabled: !frozen,
    queryFn: async ({ pageParam, signal }) => {
      const pageInput = queryDescriptor.getPageInput(pageParam as string | undefined);
      let page = await fetchStreamPage(pageInput, { signal });
      if (pageParam == null && page.restartRequired) {
        page = await fetchStreamPage(pageInput, { signal });
        if (page.restartRequired) {
          throw new Error("Stream restart did not produce a valid first page");
        }
      }
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    streamQuery;

  // A new filter window starts fresh: generation/restart state from the
  // previous window must not trigger a background restart for the new key.
  const observedRestartFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    observedRestartFingerprintRef.current = null;
  }, [queryDescriptor.filterSignature]);

  // Replace an invalid paginated window only after its fresh first page is
  // ready. Resetting the query first would briefly replace the loaded list
  // with its skeleton during background refreshes.
  useEffect(() => {
    const pages = data?.pages;
    if (!pages || pages.length === 0) return;

    const anyRestart = pages.some((p) => p.restartRequired);
    const firstGen = pages[0]?.generation;
    if (firstGen == null) return;

    const generationChanged =
      anyRestart || (pages.length > 1 && pages.some((p) => p.generation !== firstGen));
    if (!generationChanged) return;
    const fingerprint = pages
      .map((page) => `${page.generation}:${page.restartRequired ? "1" : "0"}`)
      .join("|");
    if (observedRestartFingerprintRef.current === fingerprint) return;
    observedRestartFingerprintRef.current = fingerprint;
    let cancelled = false;
    void (async () => {
      try {
        const firstPageInput = queryDescriptor.getPageInput(undefined);
        let page = await fetchStreamPage(firstPageInput);
        if (page.restartRequired) page = await fetchStreamPage(firstPageInput);
        if (page.restartRequired || cancelled) return;
        queryClient.setQueryData<InfiniteData<StreamPage, string | undefined>>(streamPageKey, {
          pages: [page],
          pageParams: [undefined],
        });
      } catch {
        // Keep the last rendered window. A later refresh can provide a new
        // fingerprint and retry without blanking the list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, queryClient, queryDescriptor, streamPageKey]);

  const streamGroups = useMemo(
    () => buildUnifiedStreamGroups(uniquePagedItems(data?.pages), mainCurrency),
    [data, mainCurrency]
  );

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    rootMargin: "400px",
  });

  // --- Selection and batch commands -----------------------------------------

  const allSourceDocumentIds = useMemo(
    () => streamGroups.flatMap((g) => g.items.map((i) => i.sourceDocument.id)),
    [streamGroups]
  );
  // Loaded records whose processing failed or was cancelled: the ones a batch
  // retry or delete is usually meant for.
  const abnormalSourceDocumentIds = useMemo(
    () =>
      streamGroups.flatMap((g) =>
        g.items
          .filter((i) => ABNORMAL_STATUSES.has(i.sourceDocument.processingStatus))
          .map((i) => i.sourceDocument.id)
      ),
    [streamGroups]
  );
  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "stream",
        period: periodKey(period),
        filters: advancedFilters,
        bookId,
      }),
    [advancedFilters, bookId, period]
  );
  const {
    isSelectionMode,
    toggleSelectionMode,
    selectedIds,
    toggleSelection,
    handleSelectMany,
    selectAll,
    clearSelection,
    exitSelectionMode,
    retainSelection,
    isAllSelected,
    isSelectionLimitReached,
    selectableCount,
  } = useSelection({ allIds: allSourceDocumentIds, queryFingerprint });
  if (frozen !== isSelectionMode) setFrozen(isSelectionMode);

  const selectedEntryIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return [
      ...new Set(
        streamGroups.flatMap((group) =>
          group.items.flatMap((item) =>
            selected.has(item.sourceDocument.id) ? item.ledgerEntries.map((entry) => entry.id) : []
          )
        )
      ),
    ];
  }, [selectedIds, streamGroups]);

  const settleBatchResult = (
    result: PartialBatchCommandResult,
    successLabel: string,
    preserveIds: string[] = []
  ) => {
    const unresolved = result.failed.map((item) => item.id);
    const retained = [...new Set([...preserveIds, ...unresolved])];
    // Selecting freezes the list, so a batch that went through leaves selection
    // mode: the list reads again and the rows it removed or moved go away. Only
    // the records that failed stay selected, to retry.
    if (retained.length === 0) exitSelectionMode();
    else retainSelection(retained);
    if (result.succeeded.length > 0) toast.success(successLabel);
    if (unresolved.length > 0) {
      toast.warning(
        batchActionsCopy.partialResult({
          succeeded: result.succeeded.length,
          failed: result.failed.length,
        })
      );
    }
  };

  const batchUpdateDates = useLedgerMutation<
    BatchUpdateSourceDocumentsResultDto,
    { ids: string[]; entryDate: string }
  >({
    waitFor: false,
    mutationFn: ({ ids, entryDate }) =>
      batchUpdateSourceDocumentsAction({
        sourceDocumentIds: ids,
        data: { documentDate: entryDate },
      }),
    onSuccess: (result) => {
      toast.success(batchActionsCopy.datesUpdated({ count: result.updatedCount }));
      exitSelectionMode();
    },
    errorMessage: commonCopy.error,
  });

  const batchDelete = useLedgerMutation<
    PartialBatchCommandResult,
    { ids: string[]; onCommitted: () => void }
  >({
    waitFor: false,
    mutationFn: ({ ids }) => batchDeleteSourceDocumentsAction(ids),
    onSuccess: (result, { onCommitted }) => {
      if (result.failed.length === 0) onCommitted();
      settleBatchResult(result, batchActionsCopy.deleted({ count: result.succeeded.length }));
    },
    errorMessage: commonCopy.deleteFailed,
  });

  const batchRetry = useLedgerMutation<PartialBatchCommandResult, string[]>({
    waitFor: false,
    mutationFn: (ids) => batchRetrySourceDocumentsAction(ids),
    onSuccess: (result) =>
      settleBatchResult(result, batchActionsCopy.retried({ count: result.succeeded.length })),
    errorMessage: commonCopy.error,
  });

  const isBatchPending =
    batchUpdateDates.isPending || batchDelete.isPending || batchRetry.isPending;

  const handleToggleSelection = useCallback(
    (id: string) => {
      if (!isBatchPending) toggleSelection(id);
    },
    [isBatchPending, toggleSelection]
  );

  const handleSetGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isBatchPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isBatchPending]
  );

  // --- Row recovery ---------------------------------------------------------

  const recoveryLocksRef = useRef(new Set<string>());
  const [retryingIds, setRetryingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(() => new Set());

  const retryMutation = useLedgerMutation<unknown, StreamRecoveryVariables>({
    mutationFn: ({ sourceDocumentId }) => retrySourceDocumentAction(sourceDocumentId),
    successMessage: sourceDocumentActionCopy.retrySuccess,
    errorMessage: sourceDocumentActionCopy.retryError,
  });
  const cancelMutation = useLedgerMutation<unknown, StreamRecoveryVariables>({
    mutationFn: ({ sourceDocumentId }) => cancelSourceDocumentProcessingAction(sourceDocumentId),
    successMessage: sourceDocumentActionCopy.cancelSuccess,
    errorMessage: sourceDocumentActionCopy.cancelError,
  });
  const retryMutationRef = useRef(retryMutation.mutateAsync);
  const cancelMutationRef = useRef(cancelMutation.mutateAsync);
  useLayoutEffect(() => {
    retryMutationRef.current = retryMutation.mutateAsync;
    cancelMutationRef.current = cancelMutation.mutateAsync;
  });

  const runRecovery = useCallback(
    async (
      variables: StreamRecoveryVariables,
      action: RecoveryAction,
      setPending: Dispatch<SetStateAction<ReadonlySet<string>>>
    ) => {
      const { sourceDocumentId } = variables;
      if (recoveryLocksRef.current.has(sourceDocumentId)) return;
      recoveryLocksRef.current.add(sourceDocumentId);
      const markPending = (pending: boolean) =>
        setPending((current) => {
          const next = new Set(current);
          if (pending) next.add(sourceDocumentId);
          else next.delete(sourceDocumentId);
          return next;
        });
      markPending(true);
      try {
        await action(variables);
      } catch {
        // The mutation owns user-visible error reporting.
      } finally {
        recoveryLocksRef.current.delete(sourceDocumentId);
        markPending(false);
      }
    },
    []
  );
  const retryRecovery = useCallback(
    (variables: StreamRecoveryVariables) =>
      runRecovery(variables, retryMutationRef.current, setRetryingIds),
    [runRecovery]
  );
  const cancelRecovery = useCallback(
    (variables: StreamRecoveryVariables) =>
      runRecovery(variables, cancelMutationRef.current, setCancellingIds),
    [runRecovery]
  );
  const recovery = useMemo(
    () => ({
      retryingIds,
      cancellingIds,
      retry: retryRecovery,
      cancelProcessing: cancelRecovery,
    }),
    [cancellingIds, cancelRecovery, retryRecovery, retryingIds]
  );

  // --- Dialogs --------------------------------------------------------------

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [retrySourceDocument, setRetrySourceDocument] = useState<SourceDocumentListItemDto | null>(
    null
  );

  const deleteSourceDocument = useLedgerMutation<void, string>({
    waitFor: false,
    mutationFn: async (id) => {
      await deleteSourceDocumentAction(id);
    },
    successMessage: commonCopy.deleteSuccess,
    errorMessage: commonCopy.deleteFailed,
    onSuccess: () => {
      setDeleteConfirm((prev) => ({ ...prev, open: false }));
      exitSelectionMode();
    },
  });

  const handleRequestDelete = useCallback((doc: SourceDocumentListItemDto) => {
    setDeleteConfirm({ open: true, id: doc.id });
  }, []);

  const handleViewSourceDetail = useCallback(
    (group: { sourceDocument: SourceDocumentListItemDto; ledgerEntries: LedgerEntry[] }) => {
      openLedgerDetail(group.sourceDocument.id);
    },
    []
  );

  // An entry row opens the record it belongs to; entries have no sheet of
  // their own.
  const handleViewLedgerEntry = useCallback(
    (entry: LedgerEntry) => openLedgerEntrySourceDocument(entry),
    []
  );

  return {
    filters,
    stream: {
      groups: streamGroups,
      isLoading: streamQuery.isLoading,
      isError: streamQuery.status === "error" || totalQuery.isError,
      hasData: data !== undefined,
      retry: () => {
        void streamQuery.refetch();
        void totalQuery.refetch();
      },
      hasNextPage,
      isFetchingNextPage,
      isFetchNextPageError,
      fetchNextPage,
      sentinelRef,
      filteredTotal: totalQuery.data?.total,
      hasUnconverted: (totalQuery.data?.unconvertedCount ?? 0) > 0,
    },
    selection: {
      isSelectionMode,
      isAllSelected,
      isSelectionLimitReached,
      hasMoreData: hasNextPage || allSourceDocumentIds.length > selectableCount,
      loadedCount: allSourceDocumentIds.length,
      selectedIds,
      selectedEntryIds,
      isBatchPending,
      isUpdatingDates: batchUpdateDates.isPending,
      isRetrying: batchRetry.isPending,
      isDeleting: batchDelete.isPending,
      handleToggleSelectionMode: () => {
        if (!isBatchPending) toggleSelectionMode();
      },
      handleToggleSelection,
      handleSetGroupSelection,
      handleSelectAll: () => {
        if (!isBatchPending) selectAll();
      },
      abnormalCount: abnormalSourceDocumentIds.length,
      handleSelectAbnormal: () => {
        if (!isBatchPending) retainSelection(abnormalSourceDocumentIds);
      },
      handleClearSelection: () => {
        if (!isBatchPending) clearSelection();
      },
      handleUpdateDates: (date: string, ids: string[]) =>
        batchUpdateDates.mutate({ ids, entryDate: date }),
      handlePreviewDateImpact: (sourceDocumentIds: string[], entryIds: string[]) =>
        fetchSourceDocumentDateImpact({ sourceDocumentIds, ledgerEntryIds: entryIds }),
      handleRetry: async () => {
        await batchRetry.mutateAsync(selectedIds);
      },
      handleDelete: async (onCommitted: () => void) => {
        const result = await batchDelete.mutateAsync({ ids: selectedIds, onCommitted });
        return result.failed.length === 0;
      },
    },
    recovery,
    dialogs: {
      deleteConfirmOpen: deleteConfirm.open,
      setDeleteConfirmOpen: (open: boolean) => setDeleteConfirm((prev) => ({ ...prev, open })),
      retrySourceDocument,
      setRetrySourceDocument,
      closeRetrySourceDocument: () => setRetrySourceDocument(null),
    },
    actions: {
      handleViewSourceDetail,
      handleViewLedgerEntry,
      handleRequestDelete,
      handleConfirmDelete: async () => {
        if (deleteConfirm.id == null || deleteConfirm.id === "") return;
        await deleteSourceDocument.mutateAsync(deleteConfirm.id);
      },
    },
  };
}
