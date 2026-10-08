import { useState } from "react";
import { ArrowLeft, SquareCheckBig } from "lucide-react";
import { useIsPhoneLayout } from "@/hooks/use-is-phone-layout";
import { useHeaderSelection } from "../store";
import { Button } from "@/components/ui/button";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { EntryFilterPanel, type EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { countActiveEntryFilters } from "@/modules/ledger/filters";
import {
  BatchDateDialog,
  batchDateImpactSummary,
  LedgerEntriesBatchActionToolbar,
} from "@/modules/ledger/ui/batch-action-toolbar";
import type { Period } from "@/modules/ledger/domain/period";
import { cn } from "@/lib/utils";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { PeriodBar } from "./PeriodBar";
import { formatPeriodLabel } from "../period-label";
import { useBatchDatePreview } from "../hooks/useBatchDatePreview";
import type { BatchEntryDateImpact, EntryCategoryDto } from "@/modules/ledger/contracts";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy } from "@/copy/workspace";

interface LedgerEntriesToolbarProps {
  isSelectionMode: boolean;
  isAllSelected: boolean;
  hasMoreData?: boolean;
  selectedCount: number;
  /** How many records the stream has loaded, which select-all takes in. */
  loadedCount: number;
  selectedSourceDocumentIds?: string[];
  selectedEntryIds?: string[];
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  /** Selects the loaded records whose processing failed or was cancelled. */
  selectAbnormal?: { count: number; onSelect: () => void };
  onClearSelection: () => void;
  onUpdateDates?: (date: string, sourceDocumentIds: string[]) => Promise<void> | void;
  onPreviewDateImpact?: (
    sourceDocumentIds: string[],
    entryIds: string[]
  ) => Promise<BatchEntryDateImpact>;
  isUpdatingDates?: boolean;
  onRetry?: () => Promise<void> | void;
  onDelete?: (onCommitted: () => void) => Promise<void | boolean> | void;
  isRetrying?: boolean;
  isDeleting?: boolean;
  isProcessing?: boolean;
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  categories: EntryCategoryDto[];
  preferredCurrencies: string[];
  period: Period;
  /** Today in the ledger's zone, which the period is counted from. */
  today: string;
  onPeriodChange: (period: Period) => void;
  mainCurrency: string;
  filteredTotal?: string;
  timeZone?: string;
}

export function LedgerEntriesToolbar({
  isSelectionMode,
  isAllSelected,
  hasMoreData = false,
  selectedCount,
  loadedCount,
  selectedSourceDocumentIds = [],
  selectedEntryIds = [],
  onToggleSelectionMode,
  onSelectAll,
  selectAbnormal,
  onClearSelection,
  onUpdateDates,
  onPreviewDateImpact,
  isUpdatingDates = false,
  onRetry,
  onDelete,
  isRetrying = false,
  isDeleting = false,
  isProcessing: externallyProcessing = false,
  filters,
  onFiltersChange,
  categories,
  preferredCurrencies,
  period,
  today,
  onPeriodChange,
  mainCurrency,
  filteredTotal,
  timeZone,
}: LedgerEntriesToolbarProps) {
  const locale = DISPLAY_LOCALE;
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date()) ?? ""
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const isProcessing = externallyProcessing || isUpdatingDates || isRetrying || isDeleting;
  const datePreview = useBatchDatePreview<BatchEntryDateImpact>(() =>
    onPreviewDateImpact == null
      ? Promise.reject(new Error("No date preview on this surface"))
      : onPreviewDateImpact([...selectedSourceDocumentIds], [...selectedEntryIds])
  );

  const phone = useIsPhoneLayout();
  useHeaderSelection({
    active: isSelectionMode,
    disabled: isProcessing,
    selectedCount,
    loadedCount,
    hasMore: hasMoreData,
    allSelected: isAllSelected ? true : selectedCount > 0 ? "indeterminate" : false,
    onToggle: onToggleSelectionMode,
    onToggleAll: () => (isAllSelected ? onClearSelection() : onSelectAll()),
  });

  const handleOpenDateDialog = () => {
    setDateDialogOpen(true);
    if (onPreviewDateImpact != null) datePreview.start();
  };

  const handleDateDialogOpenChange = (open: boolean) => {
    if (!open) datePreview.close();
    setDateDialogOpen(open);
  };

  const handleConfirmDate = async () => {
    if (onUpdateDates == null) return;
    await onUpdateDates(selectedDate, [...selectedSourceDocumentIds]);
    handleDateDialogOpenChange(false);
  };

  const batchToolbar = isSelectionMode ? (
    <LedgerEntriesBatchActionToolbar
      layout={phone ? "dock" : "band"}
      className="min-w-0 flex-1"
      selectedCount={selectedCount}
      loadedCount={loadedCount}
      isAllSelected={isAllSelected}
      hasMoreData={hasMoreData}
      onSelectAll={onSelectAll}
      onClearSelection={onClearSelection}
      {...(selectAbnormal != null ? { selectAbnormal } : {})}
      {...(onUpdateDates != null ? { onChangeDate: handleOpenDateDialog } : {})}
      {...(onRetry != null ? { onRetry: () => void onRetry(), isRetrying } : {})}
      {...(onDelete != null ? { onDelete: () => setDeleteConfirmOpen(true), isDeleting } : {})}
      isProcessing={isProcessing}
    />
  ) : null;

  return (
    <>
      <EntriesToolbarShell
        periodControl={{ period, today, onChange: onPeriodChange, timeZone }}
        totalLabel={
          !isSelectionMode && filteredTotal !== undefined
            ? formatCurrencyAmount(filteredTotal, mainCurrency, locale)
            : undefined
        }
        browsing={
          isSelectionMode
            ? undefined
            : {
                period: formatPeriodLabel(period, today),
                filtered:
                  countActiveEntryFilters(filters, {
                    showCategory: true,
                    showCurrency: true,
                    showStatus: true,
                  }) > 0,
              }
        }
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSelectionMode}
          disabled={isProcessing}
          // A phone selects from its top bar; the drop-down keeps only the
          // period and the filter.
          className={cn("shrink-0 self-start max-md:hidden", TOOLBAR_ICON_BUTTON_CLASS)}
          aria-label={isSelectionMode ? batchActionsCopy.cancelSelect : batchActionsCopy.select}
          title={isSelectionMode ? batchActionsCopy.cancelSelect : batchActionsCopy.select}
        >
          {isSelectionMode ? (
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          ) : (
            <SquareCheckBig aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>

        {phone ? null : batchToolbar}

        {!isSelectionMode && (
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
              preferredCurrencies={preferredCurrencies}
              // Dropped down on a phone the filter row sits under the picker.
              className="w-auto max-md:w-full max-md:border-t max-md:border-border max-md:pt-2"
            />
          </>
        )}
        <BatchDateDialog
          open={dateDialogOpen}
          onOpenChange={handleDateDialogOpenChange}
          value={selectedDate}
          onChange={setSelectedDate}
          impact={datePreview.impact == null ? null : batchDateImpactSummary(datePreview.impact)}
          isPreviewing={datePreview.isPreviewing || isUpdatingDates}
          previewFailed={datePreview.failed}
          onRetryPreview={datePreview.start}
          {...(isAllSelected && hasMoreData ? { scopeNote: batchActionsCopy.loadedScope } : {})}
          isConfirming={isUpdatingDates}
          onConfirm={() => void handleConfirmDate()}
          {...(timeZone != null ? { timeZone } : {})}
        />
        {onDelete != null && (
          <ConfirmDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            title={batchActionsCopy.deleteTitleDocuments}
            description={batchActionsCopy.deleteDescriptionDocuments({
              count: selectedCount,
              scope: isAllSelected && hasMoreData ? batchActionsCopy.loadedScope : "",
            })}
            variant="destructive"
            confirmLabel={commonCopy.delete}
            onConfirm={onDelete}
          />
        )}
      </EntriesToolbarShell>
      {phone ? batchToolbar : null}
    </>
  );
}
