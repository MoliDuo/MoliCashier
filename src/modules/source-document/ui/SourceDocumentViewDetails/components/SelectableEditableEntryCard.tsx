"use client";
import { memo } from "react";
import type { LedgerEntryDto, EntryCategoryDto } from "@/modules/ledger/contracts";
import { Card } from "@/components/ui/card";
import { SelectableCardSurface } from "@/components/selectable-card-surface";
import { cn } from "@/lib/utils";
import { EditableLedgerEntryItem } from "../../EditableLedgerEntryItem";
import type { EntryEditData } from "@/modules/source-document/types";

interface SelectableEditableEntryCardProps {
  entry: LedgerEntryDto;
  categories: EntryCategoryDto[];
  categoryPlaceholder: string;
  preferredCurrencies: string[];
  mainCurrency: string;
  selectionMode: boolean;
  selected: boolean;
  selectionLabel: string;
  onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
  onSelectEntry: (entryId: string, selected: boolean) => void;
  sourceDocumentEntryDate: string;
  originalEntryDate: string;
  readOnly: boolean;
  onDelete?: (() => void) | undefined;
  pendingChanges?: Partial<EntryEditData>;
  /** Whether this row is the last thing inside the shared entries card. */
  isLast?: boolean;
}

/**
 * The corners of the row that closes the shared entries card. The card owns the
 * border and the corners, and the row is full-bleed inside it, so only that last
 * row follows the card's bottom corners — one pixel in, because the card's
 * border has already taken the first pixel. A selected row is outlined along the
 * card's edge instead of squaring off across the rounded corner.
 */
const LAST_ROW_RADIUS = "rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)]";

export const SelectableEditableEntryCard = memo(function SelectableEditableEntryCard({
  entry,
  categories,
  categoryPlaceholder,
  preferredCurrencies,
  mainCurrency,
  selectionMode,
  selected,
  selectionLabel,
  onEntryChange,
  onSelectEntry,
  sourceDocumentEntryDate,
  originalEntryDate,
  readOnly,
  onDelete,
  pendingChanges,
  isLast = false,
}: SelectableEditableEntryCardProps) {
  return (
    <SelectableCardSurface
      selectionMode={selectionMode}
      selected={selected}
      selectionLabel={selectionLabel}
      onToggleSelection={() => onSelectEntry(entry.id, !selected)}
      outline="outside"
      radiusClassName={isLast ? LAST_ROW_RADIUS : "rounded-none"}
    >
      <Card
        className={cn(
          "overflow-hidden rounded-none border-0 bg-surface shadow-none hover:bg-surface2/40",
          selectionMode && selected && "bg-primary/5"
        )}
      >
        <EditableLedgerEntryItem
          ledgerEntry={entry}
          categories={categories}
          categoryPlaceholder={categoryPlaceholder}
          preferredCurrencies={preferredCurrencies}
          mainCurrency={mainCurrency}
          onChange={(changes) => onEntryChange(entry.id, changes)}
          sourceDocumentEntryDate={sourceDocumentEntryDate}
          originalEntryDate={originalEntryDate}
          readOnly={readOnly}
          onDelete={onDelete}
          {...(pendingChanges !== undefined ? { pendingChanges } : {})}
        />
      </Card>
    </SelectableCardSurface>
  );
});
