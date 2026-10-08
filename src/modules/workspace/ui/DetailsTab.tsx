"use client";

import { ArrowLeft, SquareCheckBig } from "lucide-react";
import { useIsPhoneLayout } from "@/hooks/use-is-phone-layout";
import { textRoleClassName } from "@/components/typography";
import type { EntryCategoryDto, LedgerDto } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { EntryFilterPanel } from "@/modules/ledger/ui/EntryFilterPanel";
import { countActiveEntryFilters } from "@/modules/ledger/filters";
import { LedgerEntryGroupsView } from "@/modules/ledger/ui/LedgerEntryGroupsView";
import {
  BatchDateDialog,
  batchDateImpactSummary,
  LedgerEntriesBatchActionToolbar,
} from "@/modules/ledger/ui/batch-action-toolbar";
import type { Period } from "@/modules/ledger/domain/period";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { openLedgerEntrySourceDocument } from "@/modules/ledger/navigation/ledger-detail-navigation";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/EmptyState";
import { useDetailsTab } from "../hooks/useDetailsTab";
import { useHeaderSelection } from "../store";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { PeriodBar } from "./PeriodBar";
import { formatPeriodLabel } from "../period-label";
import { IncompleteConversionNotice } from "@/components/IncompleteConversionNotice";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy, detailsTabCopy, entryFilterPanelCopy } from "@/copy/workspace";

interface DetailsTabProps {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  categories: EntryCategoryDto[];
  ledger?: LedgerDto;
  period: Period;
  today: string;
  onPeriodChange: (period: Period) => void;
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters: LedgerAdvancedFilters;
  timeZone?: string;
}

export function DetailsTab({
  bookId,
  categories,
  ledger,
  period,
  today,
  onPeriodChange,
  filters,
  onFiltersChange,
  advancedFilters,
  timeZone,
}: DetailsTabProps) {
  const { sentinelRef, ...tab } = useDetailsTab({
    bookId,
    ledger,
    period,
    advancedFilters,
    timeZone,
  });
  const { entries, monthStats } = tab;
  const phone = useIsPhoneLayout();
  const selectedCount = tab.selectedIds.length;
  useHeaderSelection({
    active: tab.isSelectionMode,
    disabled: tab.isPending,
    selectedCount,
    loadedCount: entries.length,
    hasMore: tab.hasNextPage || entries.length > tab.selectableCount,
    allSelected: tab.isAllSelected ? true : selectedCount > 0 ? "indeterminate" : false,
    onToggle: tab.toggleSelectionMode,
    onToggleAll: () => {
      if (tab.isPending) return;
      if (tab.isAllSelected) tab.clearSelection();
      else tab.selectAll();
    },
  });

  if (tab.queryStatus === "error" && !tab.queryHasData) {
    return <LedgerQueryErrorBanner empty onRetry={tab.retry} />;
  }
  const batchToolbar = tab.isSelectionMode ? (
    <LedgerEntriesBatchActionToolbar
      layout={phone ? "dock" : "band"}
      selectedCount={tab.selectedIds.length}
      loadedCount={entries.length}
      isAllSelected={tab.isAllSelected}
      hasMoreData={tab.hasNextPage || entries.length > tab.selectableCount}
      onSelectAll={() => !tab.isPending && tab.selectAll()}
      onClearSelection={() => !tab.isPending && tab.clearSelection()}
      categories={categories}
      preferredCurrencies={ledger?.settings.currencies ?? []}
      onChangeCategory={async (categoryId) => {
        await tab.update.mutateAsync({ categoryId });
      }}
      onChangeCurrency={async (currency) => {
        await tab.update.mutateAsync({ currency });
      }}
      onChangeDate={tab.openDateDialog}
      onDelete={() => tab.setDeleteDialogOpen(true)}
      isDeleting={tab.remove.isPending}
      categoryDialogOpen={tab.categoryDialogOpen}
      onCategoryDialogOpenChange={tab.setCategoryDialogOpen}
      pickedCategoryIds={tab.pickedCategoryIds}
      clearCategoryPicked={tab.clearCategoryPicked}
      onToggleCategoryPick={tab.toggleCategoryPick}
      onConfirmCategory={tab.confirmCategory}
      isConfirmingCategory={tab.isConfirmingCategory}
      isAssigningCategories={false}
      isProcessing={tab.isPending}
    />
  ) : null;

  return (
    <>
      {tab.queryStatus === "error" && <LedgerQueryErrorBanner empty={false} onRetry={tab.retry} />}
      <EntriesToolbarShell
        periodControl={{ period, today, onChange: onPeriodChange, timeZone }}
        {...(!tab.isSelectionMode && monthStats.mainTotal != null
          ? {
              totalLabel: formatCurrencyAmount(
                monthStats.mainTotal,
                monthStats.mainCurrency,
                DISPLAY_LOCALE
              ),
            }
          : {})}
        browsing={
          tab.isSelectionMode
            ? undefined
            : {
                period: formatPeriodLabel(period, today),
                filtered:
                  countActiveEntryFilters(filters, {
                    showCategory: true,
                    showCurrency: true,
                    showStatus: false,
                  }) > 0,
              }
        }
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={tab.toggleSelectionMode}
          disabled={tab.isPending}
          // A phone selects from its top bar; the drop-down keeps only the
          // period and the filter.
          className={cn("shrink-0 self-start max-md:hidden", TOOLBAR_ICON_BUTTON_CLASS)}
          aria-label={tab.isSelectionMode ? batchActionsCopy.cancelSelect : batchActionsCopy.select}
        >
          {tab.isSelectionMode ? (
            <ArrowLeft className="h-4 w-4" />
          ) : (
            <SquareCheckBig className="h-4 w-4" />
          )}
        </Button>
        {phone ? null : batchToolbar != null ? (
          <div className="min-w-0 flex-1">{batchToolbar}</div>
        ) : null}
        {!tab.isSelectionMode ? (
          <>
            <PeriodBar
              // A phone steps the period from the top bar and picks it from the
              // controls dropped down, so there the row keeps only 筛选.
              className="min-w-0 max-md:hidden"
              period={period}
              today={today}
              onChange={onPeriodChange}
              {...(timeZone != null ? { timeZone } : {})}
            />
            <EntryFilterPanel
              filters={filters}
              onFiltersChange={onFiltersChange}
              categories={categories}
              preferredCurrencies={ledger?.settings.currencies ?? []}
              showStatus={false}
              // Dropped down on a phone the filter row sits under the picker.
              className="max-md:w-full max-md:border-t max-md:border-border max-md:pt-2"
            />
          </>
        ) : null}
      </EntriesToolbarShell>
      {phone ? batchToolbar : null}
      {monthStats.unconvertedCount > 0 ? <IncompleteConversionNotice className="mb-2" /> : null}
      <div className="space-y-4">
        <div className="space-y-4">
          <LedgerEntryGroupsView
            groups={tab.groupedItems}
            mainCurrency={ledger?.settings.mainCurrency ?? monthStats.mainCurrency}
            // An entry has no detail sheet of its own — opening one lands on the
            // record it belongs to, the same sheet the stream card opens.
            onView={openLedgerEntrySourceDocument}
            selectionMode={tab.isSelectionMode}
            selectedIds={tab.selectedIds}
            disableUnselected={tab.isSelectionLimitReached}
            onToggleSelection={tab.toggleEntrySelection}
            onSetGroupSelection={tab.setGroupSelection}
          />
          {tab.isLoading ? (
            <div className="space-y-4 animate-pulse" role="status" aria-busy="true">
              {[1, 2, 3].map((idx) => (
                <div key={idx} className="bg-surface rounded-xl border border-border p-4 h-20" />
              ))}
            </div>
          ) : null}
          {!tab.isLoading && entries.length === 0 ? (
            <EmptyState
              title={
                advancedFilters.search != null ||
                advancedFilters.categoryId != null ||
                advancedFilters.currency != null ||
                advancedFilters.minAmount != null ||
                advancedFilters.maxAmount != null
                  ? entryFilterPanelCopy.noMatchingResults
                  : commonCopy.noRecords
              }
            />
          ) : null}
          <div ref={sentinelRef} className="h-1" />
          {tab.isFetchingNextPage ? (
            <div className="flex justify-center py-4">
              <span className={textRoleClassName("bodyMuted")}>{commonCopy.loading}</span>
            </div>
          ) : null}
          {tab.isFetchNextPageError ? (
            <div className="flex justify-center py-4">
              <Button variant="outline" size="sm" onClick={() => void tab.fetchNextPage()}>
                {detailsTabCopy.loadMoreFailed}
              </Button>
            </div>
          ) : null}
          {!tab.hasNextPage && entries.length > 0 ? (
            <div className="flex justify-center py-4">
              <span className={textRoleClassName("meta")}>— {detailsTabCopy.noMore} —</span>
            </div>
          ) : null}
        </div>

        <ConfirmDialog
          open={tab.deleteDialogOpen}
          onOpenChange={tab.setDeleteDialogOpen}
          title={detailsTabCopy.deleteSelectedTitle}
          description={detailsTabCopy.deleteSelectedDescription({ count: tab.selectedIds.length })}
          variant="destructive"
          confirmLabel={commonCopy.delete}
          onConfirm={async () => {
            const result = await tab.remove.mutateAsync();
            return result.failed.length === 0;
          }}
        />
        <BatchDateDialog
          open={tab.dateDialogOpen}
          onOpenChange={tab.setDateDialogOpen}
          value={tab.selectedDate}
          onChange={tab.setSelectedDate}
          impact={tab.dateImpact == null ? null : batchDateImpactSummary(tab.dateImpact)}
          isPreviewing={tab.isPreviewingDate}
          previewFailed={tab.datePreviewFailed}
          onRetryPreview={tab.retryDatePreview}
          isConfirming={tab.updateDates.isPending}
          onConfirm={() => tab.updateDates.mutate()}
          {...(timeZone != null ? { timeZone } : {})}
        />
      </div>
    </>
  );
}
