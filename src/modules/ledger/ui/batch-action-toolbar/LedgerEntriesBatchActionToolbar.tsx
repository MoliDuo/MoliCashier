"use client";

import { useCallback, useState } from "react";
import { CircleAlert } from "lucide-react";
import { BatchActionButton } from "@/components/batch-action-button";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { BatchCategoryDialog } from "./BatchCategoryDialog";
import { BatchCurrencyDialog } from "./BatchCurrencyDialog";
import { BatchSetCategoryDialog } from "./BatchSetCategoryDialog";
import { textRoleClassName } from "@/components/typography";
import { LedgerEntriesActions } from "./LedgerEntriesActions";
import { SelectionBar } from "./SelectionBar";
import { batchActionsCopy } from "@/copy/workspace";

export interface LedgerEntriesBatchActionToolbarProps {
  selectedCount: number;
  loadedCount?: number;
  isAllSelected: boolean;
  hasMoreData?: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /**
   * Selects exactly the loaded rows whose processing failed or was cancelled,
   * so retry or delete can take them all at once. Only 账目 offers it.
   */
  selectAbnormal?: { count: number; onSelect: () => void };
  categories?: EntryCategoryDto[];
  preferredCurrencies?: string[];
  isChangingCategory?: boolean;
  isChangingCurrency?: boolean;
  onChangeCategory?: (categoryId: string | null) => Promise<void> | void;
  onChangeCurrency?: (currency: string) => Promise<void> | void;
  onChangeDate?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
  onSplit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  /** A classification run for this ledger is in flight. */
  isAssigningCategories?: boolean;
  /**
   * Passing this switches the category dialog from "the row you tap is applied"
   * to the confirm-based one, where several picks are a question for the model.
   * The caller owns that dialog's state, because the run it can start outlives
   * this band.
   */
  onConfirmCategory?: () => void;
  categoryDialogOpen?: boolean;
  onCategoryDialogOpenChange?: (open: boolean) => void;
  pickedCategoryIds?: readonly string[];
  /** The clear row is picked. */
  clearCategoryPicked?: boolean;
  onToggleCategoryPick?: (categoryId: string | null, picked: boolean) => void;
  isConfirmingCategory?: boolean;
  isProcessing?: boolean;
  /**
   * `band` is the selection bar and its actions inside the surface's toolbar.
   * `dock` is a phone's action bar, fixed along the bottom where the tab bar
   * was; the count and select-all are in the top bar then.
   */
  layout?: "band" | "dock";
  className?: string;
}

/**
 * The one selection band. Every surface that selects rows renders this: the
 * stream and details tabs put it inside their toolbar box, and the
 * source-document detail modal puts it in the entries card's header row.
 *
 * The band says one number, the count beside the select-all box. Which rows
 * are in is already on the rows — every selected card draws its own outline —
 * and the box's three states say the rest: empty for none, a mixed mark for
 * some, a tick for all.
 *
 * The control and the count share the first row and the actions take the
 * second, so a phone reads the band as two lines however many actions there are.
 *
 * It renders for as long as selection mode is on, including with nothing
 * selected — otherwise the empty state has no way to select all, and the rows
 * have to be entered one at a time.
 */
export function LedgerEntriesBatchActionToolbar({
  selectedCount,
  loadedCount = selectedCount,
  isAllSelected,
  hasMoreData = false,
  onSelectAll,
  onClearSelection,
  selectAbnormal,
  categories = [],
  preferredCurrencies = [],
  isChangingCategory: isChangingCategoryProp,
  isChangingCurrency: isChangingCurrencyProp,
  onChangeCategory,
  onChangeCurrency,
  onChangeDate,
  onRetry,
  isRetrying = false,
  onSplit,
  onDelete,
  isDeleting = false,
  isAssigningCategories = false,
  onConfirmCategory,
  categoryDialogOpen: categoryDialogOpenProp = false,
  onCategoryDialogOpenChange,
  pickedCategoryIds = [],
  clearCategoryPicked = false,
  onToggleCategoryPick,
  isConfirmingCategory = false,
  isProcessing: externallyProcessing = false,
  layout = "band",
  className,
}: LedgerEntriesBatchActionToolbarProps) {
  const [internalChangingCategory, setInternalChangingCategory] = useState(false);
  const [internalChangingCurrency, setInternalChangingCurrency] = useState(false);
  // The band owns both pickers: the choice is one list, and every surface that
  // renders the band gets the same one without wiring up its own dialog. The
  // category dialog is the exception — the confirm-based variant is owned by
  // whichever caller can start a run from it.
  const [internalCategoryDialogOpen, setInternalCategoryDialogOpen] = useState(false);
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);

  const confirmsCategory = onConfirmCategory != null && onToggleCategoryPick != null;
  const categoryDialogOpen = confirmsCategory ? categoryDialogOpenProp : internalCategoryDialogOpen;
  const handleCategoryDialogOpenChange = useCallback(
    (open: boolean) => {
      if (confirmsCategory) onCategoryDialogOpenChange?.(open);
      else setInternalCategoryDialogOpen(open);
    },
    [confirmsCategory, onCategoryDialogOpenChange]
  );

  const isChangingCategory = isChangingCategoryProp ?? internalChangingCategory;
  const isChangingCurrency = isChangingCurrencyProp ?? internalChangingCurrency;
  const isProcessing =
    isChangingCategory || isChangingCurrency || isConfirmingCategory || externallyProcessing;
  // Nothing selected means nothing to act on; keeping the buttons visible but
  // unavailable says what the mode offers without a layout shift on first tap.
  const actionsDisabled = isProcessing || selectedCount === 0;
  // A surface that supports none of the batch writes still gets the way to
  // select all, but no empty row of buttons.
  const hasActions =
    selectAbnormal != null ||
    onChangeCategory != null ||
    onChangeCurrency != null ||
    onChangeDate != null ||
    onRetry != null ||
    onSplit != null ||
    onDelete != null;

  // Only the actions this surface offers are named in the 100-row note.
  const limitedActions = [
    onChangeDate != null ? batchActionsCopy.batchLimitDate : null,
    onChangeCurrency != null ? batchActionsCopy.batchLimitCurrency : null,
    onDelete != null ? batchActionsCopy.batchLimitDelete : null,
  ].filter((label): label is string => label != null);

  const handleChangeCategory = useCallback(
    async (categoryId: string | null) => {
      if (!onChangeCategory) return;

      if (isChangingCategoryProp === undefined) {
        setInternalChangingCategory(true);
        try {
          await onChangeCategory(categoryId);
        } finally {
          setInternalChangingCategory(false);
        }
        return;
      }

      await onChangeCategory(categoryId);
    },
    [isChangingCategoryProp, onChangeCategory]
  );

  const handleChangeCurrency = useCallback(
    async (currency: string) => {
      if (!onChangeCurrency) return;

      if (isChangingCurrencyProp === undefined) {
        setInternalChangingCurrency(true);
        try {
          await onChangeCurrency(currency);
        } finally {
          setInternalChangingCurrency(false);
        }
        return;
      }

      await onChangeCurrency(currency);
    },
    [isChangingCurrencyProp, onChangeCurrency]
  );

  const limitNote =
    selectedCount > 100 && limitedActions.length > 0
      ? batchActionsCopy.batchLimit({ actions: limitedActions.join("、") })
      : null;
  const actions = (orientation: "row" | "stacked") => (
    <>
      {selectAbnormal != null ? (
        <BatchActionButton
          orientation={orientation}
          variant="outline"
          icon={CircleAlert}
          // Picking the rows is not an action on the selection, so it stays
          // available with nothing selected.
          disabled={isProcessing || selectAbnormal.count === 0}
          shortLabel={batchActionsCopy.selectAbnormalShort}
          onClick={selectAbnormal.onSelect}
        >
          {batchActionsCopy.selectAbnormal({ count: selectAbnormal.count })}
        </BatchActionButton>
      ) : null}
      <LedgerEntriesActions
        orientation={orientation}
        disabled={actionsDisabled}
        nonCategoryDisabled={selectedCount > 100}
        isChangingCategory={isChangingCategory}
        isChangingCurrency={isChangingCurrency}
        isRetrying={isRetrying}
        isDeleting={isDeleting}
        isAssigningCategories={isAssigningCategories}
        {...(onChangeCategory != null
          ? { onOpenCategory: () => handleCategoryDialogOpenChange(true) }
          : {})}
        {...(onChangeCurrency != null ? { onOpenCurrency: () => setCurrencyDialogOpen(true) } : {})}
        {...(onChangeDate != null ? { onChangeDate } : {})}
        {...(onRetry != null ? { onRetry } : {})}
        {...(onSplit != null ? { onSplit } : {})}
        {...(onDelete != null ? { onDelete } : {})}
      />
    </>
  );

  return (
    <>
      {layout === "dock" ? (
        hasActions ? (
          <div
            role="toolbar"
            aria-label={batchActionsCopy.actionsLabel}
            className="fixed inset-x-0 bottom-0 z-header border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            {limitNote != null ? (
              <p
                className={textRoleClassName(
                  "micro",
                  "px-3 pt-1.5 text-center text-muted-foreground"
                )}
              >
                {limitNote}
              </p>
            ) : null}
            <div className="flex h-16 items-stretch">{actions("stacked")}</div>
          </div>
        ) : null
      ) : (
        <SelectionBar
          selectedCount={selectedCount}
          loadedCount={loadedCount}
          isAllSelected={isAllSelected}
          hasMoreData={hasMoreData}
          disabled={isProcessing}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          {...(className != null ? { className } : {})}
          note={
            limitNote != null ? (
              <p>
                {limitNote}
                {onChangeCategory != null ? batchActionsCopy.categoryBatchUnlimited : null}
              </p>
            ) : null
          }
        >
          {hasActions ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2">
              {actions("row")}
            </div>
          ) : null}
        </SelectionBar>
      )}

      {onChangeCategory != null && confirmsCategory ? (
        <BatchSetCategoryDialog
          open={categoryDialogOpen}
          onOpenChange={handleCategoryDialogOpenChange}
          categories={categories}
          selectedCount={selectedCount}
          pickedCategoryIds={pickedCategoryIds}
          clearPicked={clearCategoryPicked}
          onTogglePick={onToggleCategoryPick}
          isConfirming={isConfirmingCategory}
          onConfirm={onConfirmCategory}
        />
      ) : null}
      {onChangeCategory != null && !confirmsCategory ? (
        <BatchCategoryDialog
          open={categoryDialogOpen}
          onOpenChange={handleCategoryDialogOpenChange}
          categories={categories}
          onSelect={(categoryId) => void handleChangeCategory(categoryId)}
        />
      ) : null}
      {onChangeCurrency != null ? (
        <BatchCurrencyDialog
          open={currencyDialogOpen}
          onOpenChange={setCurrencyDialogOpen}
          preferredCurrencies={preferredCurrencies}
          onSelect={(currency) => void handleChangeCurrency(currency)}
        />
      ) : null}
    </>
  );
}
