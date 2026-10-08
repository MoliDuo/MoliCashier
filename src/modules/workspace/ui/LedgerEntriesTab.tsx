import type { EntryCategoryDto, LedgerDto } from "@/modules/ledger/contracts";
import type { Period } from "@/modules/ledger/domain/period";
import { type EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { useLedgerEntriesTab } from "@/modules/workspace/hooks/useLedgerEntriesTab";
import { LedgerEntriesToolbar } from "./LedgerEntriesToolbar";
import { LedgerEntriesStreamBody } from "./LedgerEntriesStreamBody";
import { LedgerEntriesOverlays, preloadEditRetryDialog } from "./LedgerEntriesOverlays";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { IncompleteConversionNotice } from "@/components/IncompleteConversionNotice";

interface LedgerEntriesTabProps {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: LedgerDto;
  /** Offered by the filter; a bill matches when one of its entries does. */
  categories: EntryCategoryDto[];
  period: Period;
  today: string;
  onPeriodChange: (period: Period) => void;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters?: LedgerAdvancedFilters;
  collapseEntriesDefault?: boolean;
  timeZone?: string;
}

export function LedgerEntriesTab({
  bookId,
  ledger,
  categories,
  period,
  today,
  onPeriodChange,
  onFiltersChange,
  advancedFilters,
  collapseEntriesDefault = false,
  timeZone,
}: LedgerEntriesTabProps) {
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const { filters, stream, selection, recovery, dialogs, actions } = useLedgerEntriesTab({
    bookId,
    mainCurrency,
    period,
    advancedFilters,
  });

  return (
    <>
      <LedgerEntriesToolbar
        isSelectionMode={selection.isSelectionMode}
        isAllSelected={selection.isAllSelected}
        hasMoreData={selection.hasMoreData}
        selectedCount={selection.selectedIds.length}
        loadedCount={selection.loadedCount}
        selectedSourceDocumentIds={selection.selectedIds}
        selectedEntryIds={selection.selectedEntryIds}
        onToggleSelectionMode={selection.handleToggleSelectionMode}
        onSelectAll={selection.handleSelectAll}
        onClearSelection={selection.handleClearSelection}
        selectAbnormal={{
          count: selection.abnormalCount,
          onSelect: selection.handleSelectAbnormal,
        }}
        onUpdateDates={selection.handleUpdateDates}
        onPreviewDateImpact={selection.handlePreviewDateImpact}
        isUpdatingDates={selection.isUpdatingDates}
        onRetry={selection.handleRetry}
        onDelete={selection.handleDelete}
        isRetrying={selection.isRetrying}
        isDeleting={selection.isDeleting}
        isProcessing={selection.isBatchPending}
        filters={filters}
        onFiltersChange={onFiltersChange}
        categories={categories}
        preferredCurrencies={ledger?.settings.currencies ?? []}
        period={period}
        today={today}
        onPeriodChange={onPeriodChange}
        mainCurrency={mainCurrency}
        {...(stream.filteredTotal === undefined ? {} : { filteredTotal: stream.filteredTotal })}
        {...(timeZone != null ? { timeZone } : {})}
      />
      {stream.hasUnconverted ? <IncompleteConversionNotice className="mb-2" /> : null}

      {stream.isError && <LedgerQueryErrorBanner empty={!stream.hasData} onRetry={stream.retry} />}
      {(!stream.isError || stream.hasData) && (
        <LedgerEntriesStreamBody
          isLoading={stream.isLoading}
          streamGroups={stream.groups}
          mainCurrency={mainCurrency}
          filters={filters}
          onViewLedgerEntry={actions.handleViewLedgerEntry}
          onViewSourceDetail={actions.handleViewSourceDetail}
          onEditRetry={dialogs.setRetrySourceDocument}
          onEditRetryIntent={preloadEditRetryDialog}
          onDeleteSourceConfirm={actions.handleRequestDelete}
          isSelectionMode={selection.isSelectionMode}
          selectedIds={selection.selectedIds}
          disableUnselected={selection.isSelectionLimitReached}
          onToggleSelection={selection.handleToggleSelection}
          onSetGroupSelection={selection.handleSetGroupSelection}
          timeZone={timeZone}
          collapseEntriesDefault={collapseEntriesDefault}
          recovery={recovery}
          hasNextPage={stream.hasNextPage}
          isFetchingNextPage={stream.isFetchingNextPage}
          isFetchNextPageError={stream.isFetchNextPageError}
          fetchNextPage={stream.fetchNextPage}
          sentinelRef={stream.sentinelRef}
        />
      )}

      <LedgerEntriesOverlays
        deleteConfirmOpen={dialogs.deleteConfirmOpen}
        onDeleteConfirmOpenChange={dialogs.setDeleteConfirmOpen}
        onDeleteConfirm={actions.handleConfirmDelete}
        retrySourceDocument={dialogs.retrySourceDocument}
        onRetryDialogOpenChange={(open) => !open && dialogs.closeRetrySourceDocument()}
      />
    </>
  );
}
