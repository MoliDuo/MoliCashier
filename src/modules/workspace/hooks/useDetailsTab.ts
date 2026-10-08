"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CATEGORY_ASSIGNMENT_MAX_ENTRIES } from "@/config/tuning";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSelection } from "@/hooks/use-selection";
import { DISPLAY_LOCALE, QUERY } from "@/lib/constants";
import {
  formatDateTimeForApi,
  formatRelativeDateLabel,
  getDateInTimezone,
  parseDateString,
} from "@/lib/date-utils";
import { ActionRefusedError, refusalCode } from "@/lib/errors";
import { add as addDecimal } from "@/lib/money/decimal";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import { periodKey, type Period } from "@/modules/ledger/domain/period";
import type {
  ActiveLedgerEntryDto,
  BatchEntryDateImpact,
  CategoryAssignmentMode,
  CategoryAssignmentJobDto,
  LedgerDto,
  StartCategoryAssignmentErrorCode,
} from "@/modules/ledger/contracts";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";
import {
  fetchBatchEntryDateImpact,
  fetchLedgerEntries,
  fetchLedgerSummary,
} from "@/modules/ledger/queries";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
} from "@/modules/ledger/server-actions/entries";
import { startCategoryAssignmentAction } from "@/modules/ledger/server-actions/category-assignment";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { useBatchDatePreview } from "./useBatchDatePreview";
import { settleBatchResult } from "./settle-batch-result";
import { uniquePagedItems } from "../paged-items";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy, detailsTabCopy } from "@/copy/workspace";

/** One pick is written through as-is up to this many entries; more start a run. */
const DIRECT_ASSIGNMENT_LIMIT = 100;

interface EntryDateGroup {
  title: string;
  timestamp: number;
  items: ActiveLedgerEntryDto[];
  total: string;
}

interface UseDetailsTabOptions {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: LedgerDto | undefined;
  period: Period;
  advancedFilters: LedgerAdvancedFilters;
  timeZone?: string | undefined;
}

/**
 * Everything the 明细 tab does: it reads the filtered entries and their total,
 * groups them by day, and runs the batch commands on the selection — delete,
 * a date move previewed before it is confirmed, and a category assignment that
 * is either written through or handed to the page as a persistent run.
 */
export function useDetailsTab({
  bookId,
  ledger,
  period,
  advancedFilters,
  timeZone,
}: UseDetailsTabOptions) {
  const queryClient = useQueryClient();

  // --- The entries ----------------------------------------------------------

  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = useMemo(
    () =>
      buildDetailsQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        period,
        advancedFilters,
        mainCurrency,
      }),
    [advancedFilters, bookId, mainCurrency, period]
  );

  // Selecting freezes the list: a background refresh must not swap the rows
  // out from under the selection. The queries read again once it ends.
  const [frozen, setFrozen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: descriptor.summaryQueryKey,
    enabled: !frozen,
    queryFn: ({ signal }) => fetchLedgerSummary(descriptor.summaryInput, { signal }),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const entriesQuery = useInfiniteQuery({
    queryKey: descriptor.entriesQueryKey,
    enabled: !frozen,
    queryFn: ({ pageParam, signal }) =>
      fetchLedgerEntries(descriptor.getEntriesInput(pageParam as string | undefined), { signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, isLoading } =
    entriesQuery;

  const pages = entriesQuery.data?.pages;
  const entries = useMemo(() => uniquePagedItems(pages), [pages]);

  const summary = summaryQuery.data;
  const monthStats = {
    mainTotal: summary?.convertedTotal?.total ?? null,
    mainCurrency: summary?.convertedTotal?.currency ?? mainCurrency,
    unconvertedCount: summary?.unconvertedCount ?? 0,
  };

  const queryStatus =
    entriesQuery.status === "error" || summaryQuery.status === "error"
      ? "error"
      : entriesQuery.status === "pending" || summaryQuery.status === "pending"
        ? "pending"
        : "success";
  const queryHasData = entriesQuery.data !== undefined || summaryQuery.data !== undefined;

  const retry = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: queryKeys.ledger(), type: "active" });
  }, [queryClient]);

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });

  // Entries arrive newest first, so the days keep the order they were read in.
  const groupedItems = useMemo(() => {
    const groups = new Map<string, EntryDateGroup>();
    for (const entry of entries) {
      const dateStr = entry.sourceDocument.documentDate;
      let group = groups.get(dateStr);
      if (group == null) {
        group = {
          title: formatRelativeDateLabel(dateStr, DISPLAY_LOCALE, timeZone),
          timestamp: parseDateString(dateStr).getTime(),
          items: [],
          total: "0",
        };
        groups.set(dateStr, group);
      }
      group.items.push(entry);
      group.total = addDecimal(group.total, entry.convertedAmount ?? "0");
    }
    return Array.from(groups.values());
  }, [entries, timeZone]);

  // --- The selection --------------------------------------------------------

  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "details",
        period: periodKey(period),
        filters: advancedFilters,
        bookId,
      }),
    [advancedFilters, bookId, period]
  );
  const allIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const sourceDocumentIdsFor = useCallback(
    (ids: readonly string[]): string[] => {
      const sourceDocumentIds = new Set<string>();
      for (const id of ids) {
        const entry = entryById.get(id);
        if (entry == null) throw new Error("Selected entry is no longer in the loaded page");
        sourceDocumentIds.add(entry.sourceDocument.id);
      }
      return [...sourceDocumentIds].sort((left, right) => left.localeCompare(right));
    },
    [entryById]
  );
  const selection = useSelection({ allIds, queryFingerprint, maxSelected: null });
  // Selecting freezes the list, so a command that went through leaves selection
  // mode and the list reads again; only failures stay selected.
  const { selectedIds, exitSelectionMode, isSelectionMode } = selection;
  if (frozen !== isSelectionMode) setFrozen(isSelectionMode);

  // --- Batch update and delete ----------------------------------------------

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const update = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { categoryId?: string | null; currency?: string | null }
  >({
    waitFor: false,
    mutationFn: (data) =>
      batchUpdateLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds, data),
    errorMessage: commonCopy.error,
    onSuccess: (result) => {
      if (result.affectedCount > 0)
        toast.success(detailsTabCopy.batchUpdated({ count: result.affectedCount }));
      exitSelectionMode();
    },
  });

  const remove = useLedgerMutation<
    Awaited<ReturnType<typeof batchDeleteLedgerEntriesAction>>,
    void
  >({
    waitFor: false,
    mutationFn: () =>
      batchDeleteLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds),
    errorMessage: commonCopy.deleteFailed,
    onSuccess: (result) => {
      if (result.failed.length === 0) setDeleteDialogOpen(false);
      settleBatchResult(result, {
        successLabel: detailsTabCopy.batchDeleted({ count: result.succeeded.length }),
        exitSelectionMode,
        retainSelection: selection.retainSelection,
      });
    },
  });

  // --- Batch date -----------------------------------------------------------

  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date())
  );
  const datePreview = useBatchDatePreview(() => fetchBatchEntryDateImpact([...selectedIds]));
  const { start: startDatePreview, close: closeDatePreview } = datePreview;

  const setDateDialogVisibility = useCallback(
    (open: boolean) => {
      closeDatePreview();
      setDateDialogOpen(open);
    },
    [closeDatePreview]
  );

  // The dialog opens on the day the user is about to set and fills in what the
  // change touches, instead of asking for the day first and the impact after.
  const openDateDialog = useCallback(() => {
    setDateDialogVisibility(true);
    startDatePreview();
  }, [setDateDialogVisibility, startDatePreview]);

  const dateImpact = datePreview.impact;
  const datePreviewFailed = datePreview.failed;
  const isPreviewingDate = datePreview.isPreviewing;

  const updateDates = useLedgerMutation<{ impact: BatchEntryDateImpact }, void>({
    waitFor: false,
    mutationFn: () =>
      batchUpdateLedgerEntryDatesAction(
        sourceDocumentIdsFor(selectedIds),
        selectedIds,
        selectedDate
      ),
    errorMessage: commonCopy.error,
    onSuccess: (result) => {
      toast.success(batchActionsCopy.datesUpdated({ count: result.impact.affectedEntryCount }));
      exitSelectionMode();
      setDateDialogVisibility(false);
    },
  });

  // --- Batch category -------------------------------------------------------

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [pickedCategoryIds, setPickedCategoryIds] = useState<string[]>([]);
  const [clearCategoryPicked, setClearCategoryPicked] = useState(false);
  const categoryRequestKeyRef = useRef<string | null>(null);
  // The run outlives this tab, so the page follows it and this dialog only hands
  // it over: nothing here polls, and nothing here announces what the page began.
  const { registerSubmittedJob } = useCategoryAssignment();

  // Opening drops the picks of the previous visit, and so does closing.
  const setCategoryDialogVisibility = useCallback((open: boolean) => {
    setCategoryDialogOpen(open);
    if (open) categoryRequestKeyRef.current = null;
    setPickedCategoryIds([]);
    setClearCategoryPicked(false);
  }, []);

  // Clearing is exclusive: "no category" is not one more candidate to weigh
  // against the others, it is the other answer to the same question.
  const toggleCategoryPick = useCallback((categoryId: string | null, picked: boolean) => {
    if (categoryId == null) {
      setClearCategoryPicked(picked);
      if (picked) setPickedCategoryIds([]);
      return;
    }
    setPickedCategoryIds((current) =>
      picked
        ? current.includes(categoryId)
          ? current
          : [...current, categoryId]
        : current.filter((id) => id !== categoryId)
    );
    if (picked) setClearCategoryPicked(false);
  }, []);

  const startAiCategory = useLedgerMutation<
    CategoryAssignmentJobDto,
    { requestKey: string; mode: CategoryAssignmentMode; ledgerEntryIds: string[] }
  >({
    waitFor: false,
    mutationFn: async (input) => {
      const result = await startCategoryAssignmentAction(input);
      if (!result.ok) throw new ActionRefusedError<StartCategoryAssignmentErrorCode>(result.code);
      return result.job;
    },
    errorMessage: null,
    onSuccess: (job) => {
      // Hand the run to the page before it can finish: a run whose first answer
      // already reports it over still has to say so, once, to this reader.
      registerSubmittedJob(job);
      toast.success(batchActionsCopy.aiCategoryRunning);
      exitSelectionMode();
      categoryRequestKeyRef.current = null;
      setCategoryDialogVisibility(false);
    },
    onError: (error) => {
      toast.error(
        refusalCode<StartCategoryAssignmentErrorCode>(error) === "busy"
          ? batchActionsCopy.aiCategoryBusy
          : batchActionsCopy.aiCategoryFailed
      );
    },
  });

  /**
   * One pick is the user's own answer and is written directly; several are a
   * question for the model. Which of the two it is comes from the same resolver
   * the dialog's summary reads, so the button cannot promise one thing and do
   * another.
   *
   * The manual write leaves the dialog open when it fails — the pick is still
   * on screen to retry — while the run closes it, because the run outlives the
   * dialog and reports itself.
   */
  const { mutateAsync: assignCategory } = update;
  const { mutate: startCategoryRun } = startAiCategory;
  const confirmCategory = useCallback(() => {
    const ledgerEntryIds = [...selectedIds];
    if (ledgerEntryIds.length === 0) return;

    const pick = resolveBatchCategoryPick({
      categoryIds: pickedCategoryIds,
      clearPicked: clearCategoryPicked,
    });
    if (
      (pick.kind === "clear" || pick.kind === "assign") &&
      ledgerEntryIds.length <= DIRECT_ASSIGNMENT_LIMIT
    ) {
      void assignCategory({ categoryId: pick.kind === "clear" ? null : pick.categoryId }).then(
        () => setCategoryDialogVisibility(false),
        () => undefined
      );
      return;
    }
    if (pick.kind === "ai" || pick.kind === "assign" || pick.kind === "clear") {
      if (ledgerEntryIds.length > CATEGORY_ASSIGNMENT_MAX_ENTRIES) {
        toast.error(
          batchActionsCopy.categorySelectionTooLarge({ max: CATEGORY_ASSIGNMENT_MAX_ENTRIES })
        );
        return;
      }
      startCategoryRun({
        requestKey: (categoryRequestKeyRef.current ??= crypto.randomUUID()),
        ledgerEntryIds,
        mode:
          pick.kind === "ai"
            ? { kind: "ai", candidateCategoryIds: [...pick.categoryIds] }
            : pick.kind === "assign"
              ? { kind: "assign", categoryId: pick.categoryId }
              : { kind: "clear" },
      });
    }
  }, [
    assignCategory,
    clearCategoryPicked,
    pickedCategoryIds,
    selectedIds,
    setCategoryDialogVisibility,
    startCategoryRun,
  ]);

  const isPending =
    update.isPending ||
    remove.isPending ||
    isPreviewingDate ||
    updateDates.isPending ||
    startAiCategory.isPending;

  // A command in flight holds the selection it was given.
  const { toggleSelection, handleSelectMany } = selection;
  const toggleEntrySelection = useCallback(
    (id: string) => {
      if (!isPending) toggleSelection(id);
    },
    [isPending, toggleSelection]
  );
  const setGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isPending]
  );

  return {
    queryStatus,
    queryHasData,
    retry,
    entries,
    groupedItems,
    monthStats,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    sentinelRef,
    ...selection,
    toggleEntrySelection,
    setGroupSelection,
    isPending,
    update,
    remove,
    deleteDialogOpen,
    setDeleteDialogOpen,
    dateDialogOpen,
    setDateDialogOpen: setDateDialogVisibility,
    openDateDialog,
    retryDatePreview: startDatePreview,
    selectedDate,
    setSelectedDate,
    dateImpact,
    datePreviewFailed,
    isPreviewingDate,
    updateDates,
    categoryDialogOpen,
    setCategoryDialogOpen: setCategoryDialogVisibility,
    pickedCategoryIds,
    clearCategoryPicked,
    toggleCategoryPick,
    confirmCategory,
    isConfirmingCategory: update.isPending || startAiCategory.isPending,
  };
}
