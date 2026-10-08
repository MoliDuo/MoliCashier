"use client";

import { useCallback, useMemo } from "react";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { EntryGroupHeader, groupSelectionState } from "@/components/EntryGroupHeader";
import { LedgerEntryCard } from "./LedgerEntryCard";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { batchActionsCopy } from "@/copy/workspace";

interface LedgerEntryGroupsViewProps {
  groups: readonly { title: string; items: LedgerEntryDto[]; total: string }[];
  mainCurrency: string;
  onView: (entry: LedgerEntryDto) => void;
  selectionMode?: boolean;
  selectedIds?: readonly string[];
  disableUnselected?: boolean;
  onToggleSelection?: (id: string) => void;
  /** Selects or clears a whole day at once. Absent where nothing selects. */
  onSetGroupSelection?: (ids: readonly string[], selected: boolean) => void;
}

export function LedgerEntryGroupsView({
  groups,
  mainCurrency,
  onView,
  selectionMode = false,
  selectedIds = [],
  disableUnselected = false,
  onToggleSelection,
  onSetGroupSelection,
}: LedgerEntryGroupsViewProps) {
  const locale = DISPLAY_LOCALE;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // The day band is the day's own checkbox while the list is selecting: the box
  // says how much of the day is in, the whole band is the tap target.
  const headerSelection = useCallback(
    (title: string, entryIds: readonly string[]) => {
      if (!selectionMode || onSetGroupSelection == null) return {};
      const state = groupSelectionState(entryIds, selectedIdSet);
      return {
        selection: {
          state,
          disabled: disableUnselected && state === "none",
          label:
            state === "all"
              ? batchActionsCopy.deselectDay({ date: title })
              : batchActionsCopy.selectDay({ date: title }),
          onToggle: () => onSetGroupSelection(entryIds, state !== "all"),
        },
      };
    },
    [disableUnselected, onSetGroupSelection, selectedIdSet, selectionMode]
  );
  // A plain list: the entries page twenty at a time, and scrolling, restoring
  // and selecting stay predictable without a virtual window.
  return groups.map((group) => (
    <div key={group.title} className="ledger-list-group space-y-2">
      <EntryGroupHeader
        title={group.title}
        totalLabel={formatCurrencyAmount(group.total, mainCurrency, locale)}
        {...headerSelection(
          group.title,
          group.items.map((entry) => entry.id)
        )}
      />
      <div className="space-y-4">
        {group.items.map((entry) => (
          <LedgerEntryCard
            key={entry.id}
            ledgerEntry={entry}
            mainCurrency={mainCurrency}
            onView={onView}
            selectionMode={selectionMode}
            isSelected={selectedIdSet.has(entry.id)}
            selectionDisabled={disableUnselected && !selectedIdSet.has(entry.id)}
            {...(onToggleSelection == null ? {} : { onToggleSelect: onToggleSelection })}
          />
        ))}
      </div>
    </div>
  ));
}
