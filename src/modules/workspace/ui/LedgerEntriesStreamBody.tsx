"use client";
import { textRoleClassName } from "@/components/typography";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { LedgerEntriesLoading } from "./LedgerEntriesLoading";
import { LedgerEntriesUnifiedGroups } from "./UnifiedStreamGroups";
import type { useLedgerEntriesTab } from "@/modules/workspace/hooks/useLedgerEntriesTab";
import { commonCopy } from "@/copy/common";
import { entryFilterPanelCopy, ledgerEntriesTabCopy } from "@/copy/workspace";

interface LedgerEntriesStreamBodyProps {
  isLoading: boolean;
  streamGroups: UnifiedStreamGroup[];
  mainCurrency: string;
  filters: EntryFilters;
  onViewLedgerEntry: (entry: LedgerEntryDto) => void;
  onViewSourceDetail: (group: {
    sourceDocument: SourceDocumentListItemDto;
    ledgerEntries: LedgerEntryDto[];
  }) => void;
  onViewSourceDetailIntent?: (doc: SourceDocumentListItemDto) => void;
  onEditRetry: (doc: SourceDocumentListItemDto) => void;
  onEditRetryIntent?: () => void;
  onDeleteSourceConfirm: (doc: SourceDocumentListItemDto) => void;
  isSelectionMode: boolean;
  selectedIds: string[];
  disableUnselected: boolean;
  onToggleSelection: (id: string) => void;
  onSetGroupSelection?: (ids: readonly string[], selected: boolean) => void;
  timeZone?: string | undefined;
  collapseEntriesDefault: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => void;
  sentinelRef: (node: HTMLDivElement | null) => void;
  recovery: ReturnType<typeof useLedgerEntriesTab>["recovery"];
}

/** The stream tab's list body: loading state, grouped results, empty state, and pagination footer. */
export function LedgerEntriesStreamBody({
  isLoading,
  streamGroups,
  mainCurrency,
  filters,
  onViewLedgerEntry,
  onViewSourceDetail,
  onViewSourceDetailIntent,
  onEditRetry,
  onEditRetryIntent,
  onDeleteSourceConfirm,
  isSelectionMode,
  selectedIds,
  disableUnselected,
  onToggleSelection,
  onSetGroupSelection,
  timeZone,
  collapseEntriesDefault,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  fetchNextPage,
  sentinelRef,
  recovery,
}: LedgerEntriesStreamBodyProps) {
  return (
    <div className="space-y-4">
      {isLoading ? (
        <LedgerEntriesLoading />
      ) : (
        <>
          {/* Unified stream groups — all states in a single chronological sequence */}
          {streamGroups.length > 0 && (
            <LedgerEntriesUnifiedGroups
              streamGroups={streamGroups}
              mainCurrency={mainCurrency}
              onViewLedgerEntry={onViewLedgerEntry}
              onViewSourceDetail={onViewSourceDetail}
              {...(onViewSourceDetailIntent != null ? { onViewSourceDetailIntent } : {})}
              onEditRetry={onEditRetry}
              {...(onEditRetryIntent != null ? { onEditRetryIntent } : {})}
              onDeleteSourceConfirm={onDeleteSourceConfirm}
              isSelectionMode={isSelectionMode}
              selectedIds={selectedIds}
              disableUnselected={disableUnselected}
              onToggleSelection={onToggleSelection}
              {...(onSetGroupSelection != null ? { onSetGroupSelection } : {})}
              {...(timeZone != null ? { timeZone } : {})}
              collapseEntriesDefault={collapseEntriesDefault}
              recovery={recovery}
            />
          )}

          {/* No records state */}
          {!isLoading && streamGroups.length === 0 && (
            <div className="space-y-6 pt-2">
              <div className="text-center py-20 text-muted-foreground flex flex-col items-center gap-2">
                <span>
                  {filters.search != null ||
                  filters.minAmount != null ||
                  filters.maxAmount != null ||
                  filters.categoryId != null ||
                  filters.currency != null ||
                  (filters.statuses?.length ?? 0) > 0
                    ? entryFilterPanelCopy.noMatchingResults
                    : commonCopy.noRecords}
                </span>
              </div>
            </div>
          )}

          {/* Load completed history before the user reaches the list end. */}
          {hasNextPage && (
            <div ref={sentinelRef} className="flex h-12 justify-center py-4" aria-live="polite">
              {isFetchNextPageError ? (
                <Button variant="outline" size="sm" onClick={() => void fetchNextPage()}>
                  {ledgerEntriesTabCopy.loadMoreFailed}
                </Button>
              ) : isFetchingNextPage ? (
                <span className={textRoleClassName("meta", "flex items-center gap-1.5")}>
                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                  {ledgerEntriesTabCopy.loadingMore}
                </span>
              ) : null}
            </div>
          )}

          {/* End of list indicator when no more pages */}
          {!hasNextPage && streamGroups.length > 0 && (
            <div className="flex justify-center py-4">
              <span className={textRoleClassName("meta")}>— {ledgerEntriesTabCopy.noMore} —</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
