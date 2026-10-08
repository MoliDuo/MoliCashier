"use client";
import type { LedgerEntryEmbeddedViewDto, EntryCategoryDto } from "@/modules/ledger/contracts";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import { type ReactNode, memo } from "react";
import { cn } from "@/lib/utils";
import type { EntryEditData } from "@/modules/source-document/detail-types";
import { SourceDocumentEntriesHeader } from "./SourceDocumentViewDetails/components/SourceDocumentEntriesHeader";
import { SourceDocumentEntriesList } from "./SourceDocumentViewDetails/components/SourceDocumentEntriesList";
import { SourceDocumentRawEvidence } from "./SourceDocumentViewDetails/components/SourceDocumentRawEvidence";
import { SourceDocumentDateOrganization } from "./SourceDocumentDateOrganization";
import { SourceDocumentDuplicateSuggestion } from "./SourceDocumentDuplicateSuggestion";
import type { ApplyDateOrganizationInput } from "../contracts";

interface SourceDocumentViewDetailsProps {
  sourceDocument: SourceDocumentDetailDto;
  // These entries are always the embedded, sourceDocument-less view (see
  // listLedgerEntryViewsBySourceDocumentIds); typing this as the wider
  // LedgerEntry would let `.sourceDocument` type-check while silently
  // reading undefined at runtime.
  ledgerEntries: LedgerEntryEmbeddedViewDto[];
  /** Entry values being written, shown in place of the saved ones. */
  pendingEntries: Record<string, Partial<EntryEditData>>;
  /** Entries whose write has not settled; each such row waits. */
  savingEntryIds: readonly string[];
  /** The record's date as shown, including one being written. */
  documentDate: string;
  categories: EntryCategoryDto[];
  preferredCurrencies?: string[];
  mainCurrency?: string;
  selectedEntryIds: string[];
  isSelectionMode: boolean;
  /** Writes one field of one entry. */
  onEntryChange: (entryId: string, changes: Partial<EntryEditData>) => void;
  onSelectEntry: (entryId: string, selected: boolean) => void;
  onToggleSelectionMode: () => void;
  /** Nothing is editable: the record is processing, loading or mid-command. */
  readOnly: boolean;
  isAddingEntry: boolean;
  onAddEntry: () => void;
  onDeleteEntry: (entryId: string) => void;
  onApplyDateOrganization?: (
    input: Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  ) => Promise<unknown>;
  onDismissDateOrganization?: (suggestionId: string) => Promise<unknown>;
  isOrganizingDates?: boolean;
  dateOrganizationDisabled?: boolean;
  onApplyDuplicateSuggestion?: (suggestionId: string) => Promise<unknown>;
  onDismissDuplicateSuggestion?: (suggestionId: string) => Promise<unknown>;
  isResolvingDuplicates?: boolean;
  onDateAdjustmentStateChange?: (active: boolean, dirty: boolean) => void;
  /** Which pane the narrow-viewport layout shows; desktop always shows both. */
  mobileView: "details" | "evidence";
  /** Ledger timezone; the suggestion panel names today/yesterday against it. */
  timeZone?: string;
  /**
   * The selection band, built by the sheet that owns the batch write. It takes
   * the entries card's header row for as long as selection mode is on.
   */
  selectionToolbar?: ReactNode;
}

export const SourceDocumentViewDetails = memo(function SourceDocumentViewDetails({
  sourceDocument,
  ledgerEntries,
  pendingEntries,
  savingEntryIds,
  documentDate,
  categories,
  preferredCurrencies = [],
  mainCurrency = "CNY",
  selectedEntryIds,
  isSelectionMode,
  onEntryChange,
  onSelectEntry,
  onToggleSelectionMode,
  readOnly,
  isAddingEntry,
  onAddEntry,
  onDeleteEntry,
  onApplyDateOrganization,
  onDismissDateOrganization,
  isOrganizingDates = false,
  dateOrganizationDisabled = false,
  onApplyDuplicateSuggestion,
  onDismissDuplicateSuggestion,
  isResolvingDuplicates = false,
  onDateAdjustmentStateChange,
  mobileView,
  timeZone,
  selectionToolbar,
}: SourceDocumentViewDetailsProps): ReactNode {
  const hasEvidence =
    sourceDocument.files.length > 0 ||
    (sourceDocument.text != null && sourceDocument.text.trim().length > 0);

  return (
    <div className="grid min-h-0 gap-4 lg:h-full lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
      <div
        data-testid="source-document-details-pane"
        className={cn(
          "min-w-0 space-y-4 overflow-y-auto lg:min-h-0 lg:pr-1",
          hasEvidence && mobileView === "evidence" && "hidden lg:block"
        )}
      >
        {/* Repeats come first: removing them settles which entries are left
            before any of them is moved to another day. */}
        {sourceDocument.duplicateSuggestion != null &&
        onApplyDuplicateSuggestion != null &&
        onDismissDuplicateSuggestion != null ? (
          <SourceDocumentDuplicateSuggestion
            key={sourceDocument.duplicateSuggestion.id}
            suggestion={sourceDocument.duplicateSuggestion}
            disabled={readOnly || isResolvingDuplicates || dateOrganizationDisabled}
            onApply={onApplyDuplicateSuggestion}
            onDismiss={onDismissDuplicateSuggestion}
          />
        ) : null}

        {/* The suggestion leads: it is about to change the dates of the
            entries below, so it sits above them. */}
        {sourceDocument.dateOrganizationSuggestion != null &&
        onApplyDateOrganization != null &&
        onDismissDateOrganization != null ? (
          <SourceDocumentDateOrganization
            key={sourceDocument.dateOrganizationSuggestion.id}
            suggestion={sourceDocument.dateOrganizationSuggestion}
            entries={ledgerEntries}
            mainCurrency={mainCurrency}
            disabled={readOnly || isOrganizingDates || dateOrganizationDisabled}
            onApply={onApplyDateOrganization}
            onDismiss={onDismissDateOrganization}
            {...(timeZone != null ? { timeZone } : {})}
            {...(onDateAdjustmentStateChange == null
              ? {}
              : { onAdjustmentStateChange: onDateAdjustmentStateChange })}
          />
        ) : null}

        {/* The header and the entries are one card. Deliberately not clipped:
            a selected entry row is outlined one pixel outside itself, which is
            exactly the border the card draws there, so clipping would leave the
            outline with only its top and bottom. */}
        <div className="min-w-0 rounded-lg border border-border bg-surface">
          <SourceDocumentEntriesHeader
            entryCount={ledgerEntries.length}
            isSelectionMode={isSelectionMode}
            canSelect={ledgerEntries.length > 0 && (!readOnly || isSelectionMode)}
            onToggleSelectionMode={onToggleSelectionMode}
            {...(selectionToolbar != null ? { selectionToolbar } : {})}
          />

          <SourceDocumentEntriesList
            entries={ledgerEntries}
            pendingEntries={pendingEntries}
            savingEntryIds={savingEntryIds}
            categories={categories}
            preferredCurrencies={preferredCurrencies}
            mainCurrency={mainCurrency}
            selectedEntryIds={selectedEntryIds}
            isSelectionMode={isSelectionMode}
            readOnly={readOnly}
            isAddingEntry={isAddingEntry}
            onEntryChange={onEntryChange}
            onSelectEntry={onSelectEntry}
            documentDate={documentDate}
            savedDocumentDate={sourceDocument.documentDate}
            onAddEntry={onAddEntry}
            onDeleteEntry={onDeleteEntry}
          />
        </div>
      </div>
      <aside
        className={cn(
          "min-w-0 overflow-y-auto lg:min-h-0 lg:border-l lg:pl-4",
          // Without evidence to switch to, the empty pane follows the entries.
          !hasEvidence && "border-t pt-4 lg:border-t-0 lg:pt-0",
          hasEvidence && mobileView === "details" && "hidden lg:block"
        )}
      >
        <SourceDocumentRawEvidence sourceDocument={sourceDocument} />
      </aside>
    </div>
  );
});
