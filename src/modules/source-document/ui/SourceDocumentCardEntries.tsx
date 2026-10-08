import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { memo } from "react";
import { LedgerEntryItem } from "./LedgerEntryItem";

interface SourceDocumentCardEntriesProps {
  entries: LedgerEntryDto[];
  mainCurrency: string;
  sourceDocumentEntryDate?: string | null;
  onViewLedgerEntry?: (ledgerEntry: LedgerEntryDto) => void;
}

export const SourceDocumentCardEntries = memo(function SourceDocumentCardEntries({
  entries,
  mainCurrency,
  sourceDocumentEntryDate,
  onViewLedgerEntry,
}: SourceDocumentCardEntriesProps) {
  return (
    // Full-bleed rows: the rules and the hover surface reach the card's edges,
    // the way the entry rows of the detail sheet do, and each row carries its
    // own inset so the text still lines up with the header above it.
    <div className="divide-y divide-border border-t border-border">
      {entries.map((entry) => (
        <LedgerEntryItem
          key={entry.id}
          ledgerEntry={entry}
          mainCurrency={mainCurrency}
          {...(sourceDocumentEntryDate !== undefined ? { sourceDocumentEntryDate } : {})}
          {...(onViewLedgerEntry != null ? { onView: () => onViewLedgerEntry(entry) } : {})}
        />
      ))}
    </div>
  );
});
