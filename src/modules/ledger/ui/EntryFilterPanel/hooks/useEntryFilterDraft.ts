"use client";
import * as React from "react";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { countActiveEntryFilters, type EntryFilters } from "@/modules/ledger/filters";
import { compare, DECIMAL_STRING_PATTERN, normalizeDecimalInput } from "@/lib/money/decimal";

/**
 * The amounts as they are applied: a half-typed value is read as what it means,
 * and a range typed the wrong way round is turned around.
 */
export function normalizeAmountRange(draft: EntryFilters): EntryFilters {
  const filters: EntryFilters = {
    ...draft,
    minAmount: normalizeDecimalInput(draft.minAmount),
    maxAmount: normalizeDecimalInput(draft.maxAmount),
  };
  const { minAmount, maxAmount } = filters;

  if (
    minAmount == null ||
    maxAmount == null ||
    !DECIMAL_STRING_PATTERN.test(minAmount) ||
    !DECIMAL_STRING_PATTERN.test(maxAmount) ||
    compare(minAmount, maxAmount) <= 0
  ) {
    return filters;
  }

  return {
    ...filters,
    minAmount: maxAmount,
    maxAmount: minAmount,
  };
}

interface UseEntryFilterDraftOptions {
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  showCategory: boolean;
  showCurrency: boolean;
  showStatus: boolean;
}

/** Owns the filter dialog's draft state, independent from the applied `filters` prop. */
/** Every filter off, as 清除全部 drafts it and 清除筛选 applies it. */
export const CLEARED_ENTRY_FILTERS: EntryFilters = {
  categoryId: null,
  currency: null,
  minAmount: null,
  maxAmount: null,
  statuses: [],
  search: null,
};

export function useEntryFilterDraft({
  filters,
  onFiltersChange,
  showCategory,
  showCurrency,
  showStatus,
}: UseEntryFilterDraftOptions) {
  const [open, setOpen] = React.useState(false);

  // Internal state for editing before applying - initialized from filters when dialog opens
  const [tempFilters, setTempFilters] = React.useState<EntryFilters>(filters);

  // Reset temp filters when the dialog opens (not using useEffect to sync with external filters)
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Initialize draft state from current filters when opening
      setTempFilters(filters);
    }
  };

  const activeFilterCount = countActiveEntryFilters(filters, {
    showCategory,
    showCurrency,
    showStatus,
  });

  const handleApply = () => {
    const normalizedFilters = normalizeAmountRange(tempFilters);
    onFiltersChange(normalizedFilters);
    setOpen(false);
  };

  const handleReset = () => {
    setTempFilters(CLEARED_ENTRY_FILTERS);
  };

  const toggleStatus = (status: SourceDocumentProcessingStatus) => {
    setTempFilters((prev) => {
      const current = prev.statuses ?? [];
      const exists = current.includes(status);
      return {
        ...prev,
        statuses: exists ? current.filter((s) => s !== status) : [...current, status],
      };
    });
  };

  return {
    open,
    setOpen,
    handleOpenChange,
    tempFilters,
    setTempFilters,
    activeFilterCount,
    handleApply,
    handleReset,
    toggleStatus,
  };
}
