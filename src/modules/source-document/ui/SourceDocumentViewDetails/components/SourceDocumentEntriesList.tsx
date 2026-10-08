"use client";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { EntryCategoryDto, LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import type { EntryEditData } from "@/modules/source-document/types";
import { SelectableEditableEntryCard } from "./SelectableEditableEntryCard";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentEntriesListProps {
  entries: LedgerEntryEmbeddedViewDto[];
  pendingEntries: Record<string, Partial<EntryEditData>>;
  savingEntryIds: readonly string[];
  categories: EntryCategoryDto[];
  preferredCurrencies: string[];
  mainCurrency: string;
  selectedEntryIds: string[];
  isSelectionMode: boolean;
  readOnly: boolean;
  isAddingEntry: boolean;
  onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
  onSelectEntry: (entryId: string, selected: boolean) => void;
  documentDate: string;
  savedDocumentDate: string;
  onAddEntry: () => void;
  onDeleteEntry: (entryId: string) => void;
}

/**
 * The record's entries. Tapping a row opens its fields for editing, and each
 * field is written the moment it is changed; the row waits while its write is
 * in flight.
 */
export function SourceDocumentEntriesList({
  entries,
  pendingEntries,
  savingEntryIds,
  categories,
  preferredCurrencies,
  mainCurrency,
  selectedEntryIds,
  isSelectionMode,
  readOnly,
  isAddingEntry,
  onEntryChange,
  onSelectEntry,
  documentDate,
  savedDocumentDate,
  onAddEntry,
  onDeleteEntry,
}: SourceDocumentEntriesListProps) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const editable = !readOnly && !isSelectionMode;

  return (
    <div className="min-w-0 divide-y">
      {entries.length === 0 ? (
        <p className={textRoleClassName("bodyMuted", "p-8 text-center")}>
          {sourceDocumentDetailCopy.noEntries}
        </p>
      ) : (
        entries.map((entry, index) => {
          const saving = savingEntryIds.includes(entry.id);
          const active = editable && activeEntryId === entry.id;
          return (
            <div
              key={entry.id}
              aria-busy={saving || undefined}
              onClick={() => {
                if (editable) setActiveEntryId(entry.id);
              }}
            >
              <SelectableEditableEntryCard
                entry={entry}
                categories={categories}
                categoryPlaceholder={sourceDocumentDetailCopy.selectCategory}
                preferredCurrencies={preferredCurrencies}
                mainCurrency={mainCurrency}
                selectionMode={isSelectionMode}
                selected={selectedEntryIds.includes(entry.id)}
                selectionLabel={commonCopy.selectItem({ item: entry.itemName })}
                onEntryChange={onEntryChange}
                onSelectEntry={onSelectEntry}
                sourceDocumentEntryDate={documentDate}
                originalEntryDate={savedDocumentDate}
                readOnly={!active || saving}
                isLast={!editable && index === entries.length - 1}
                onDelete={active && !saving ? () => onDeleteEntry(entry.id) : undefined}
                {...(pendingEntries[entry.id] !== undefined
                  ? { pendingChanges: pendingEntries[entry.id] }
                  : {})}
              />
            </div>
          );
        })
      )}
      {editable ? (
        <div className="p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-muted-foreground hover:text-text"
            onClick={onAddEntry}
            disabled={isAddingEntry}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {sourceDocumentDetailCopy.addEntryTitle}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
