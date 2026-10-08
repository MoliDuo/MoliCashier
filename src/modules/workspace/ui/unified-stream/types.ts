import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import type { UnifiedStreamGroup } from "@/modules/source-document/stream-grouping";
import type { useLedgerEntriesTab } from "@/modules/workspace/hooks/useLedgerEntriesTab";

export interface UnifiedStreamGroupProps {
  streamGroups: UnifiedStreamGroup[];
  mainCurrency: string;
  onViewLedgerEntry?: (entry: LedgerEntryDto) => void;
  onViewSourceDetail: (group: {
    sourceDocument: SourceDocumentListItemDto;
    ledgerEntries: LedgerEntryDto[];
  }) => void;
  onViewSourceDetailIntent?: (doc: SourceDocumentListItemDto) => void;
  onEditRetry?: (doc: SourceDocumentListItemDto) => void;
  onEditRetryIntent?: () => void;
  onDeleteSourceConfirm: (doc: SourceDocumentListItemDto) => void;
  isSelectionMode: boolean;
  selectedIds: string[];
  disableUnselected?: boolean;
  onToggleSelection: (id: string) => void;
  /** Selects or clears a whole day at once. Absent where nothing selects. */
  onSetGroupSelection?: (ids: readonly string[], selected: boolean) => void;
  timeZone?: string;
  collapseEntriesDefault?: boolean;
  recovery?: ReturnType<typeof useLedgerEntriesTab>["recovery"];
}

export type UnifiedStreamItem = UnifiedStreamGroup["items"][number];

export type RendererProps = UnifiedStreamGroupProps & {
  selectedIdSet: ReadonlySet<string>;
};
