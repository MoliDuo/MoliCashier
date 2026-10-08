import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import { SourceDocumentCard } from "@/modules/source-document/ui/SourceDocumentCard";
import { memo, useCallback } from "react";
import type { RendererProps, UnifiedStreamItem } from "./types";

interface UnifiedStreamItemRowProps {
  item: UnifiedStreamItem;
  mainCurrency: string;
  onViewLedgerEntry?: (entry: LedgerEntryDto) => void;
  onViewSourceDetail: RendererProps["onViewSourceDetail"];
  onViewSourceDetailIntent?: (doc: SourceDocumentListItemDto) => void;
  onEditRetry?: (doc: SourceDocumentListItemDto) => void;
  onEditRetryIntent?: () => void;
  onDeleteSourceConfirm: (doc: SourceDocumentListItemDto) => void;
  selectionMode: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelection: (id: string) => void;
  defaultExpanded: boolean;
  expanded?: boolean;
  onExpandedChange?: (sourceDocumentId: string, expanded: boolean) => void;
  isRetrying?: boolean;
  isCancelling?: boolean;
  onRetry?: (variables: { sourceDocumentId: string }) => Promise<void>;
  onCancelProcessing?: (variables: { sourceDocumentId: string }) => Promise<void>;
}

export function StreamItemRow({
  item,
  props,
  expanded,
  onExpandedChange,
}: {
  item: UnifiedStreamItem;
  props: RendererProps;
  expanded?: boolean;
  onExpandedChange?: (sourceDocumentId: string, expanded: boolean) => void;
}) {
  const sourceDocumentId = item.sourceDocument.id;
  const recovery = props.recovery;
  return (
    <UnifiedStreamItemRow
      item={item}
      mainCurrency={props.mainCurrency}
      {...(props.onViewLedgerEntry != null ? { onViewLedgerEntry: props.onViewLedgerEntry } : {})}
      onViewSourceDetail={props.onViewSourceDetail}
      {...(props.onViewSourceDetailIntent != null
        ? { onViewSourceDetailIntent: props.onViewSourceDetailIntent }
        : {})}
      {...(props.onEditRetry != null ? { onEditRetry: props.onEditRetry } : {})}
      {...(props.onEditRetryIntent != null ? { onEditRetryIntent: props.onEditRetryIntent } : {})}
      onDeleteSourceConfirm={props.onDeleteSourceConfirm}
      selectionMode={props.isSelectionMode}
      selected={props.selectedIdSet.has(sourceDocumentId)}
      selectionDisabled={
        props.disableUnselected === true && !props.selectedIdSet.has(sourceDocumentId)
      }
      onToggleSelection={props.onToggleSelection}
      defaultExpanded={!props.collapseEntriesDefault}
      {...(expanded === undefined ? {} : { expanded })}
      {...(onExpandedChange == null ? {} : { onExpandedChange })}
      {...(recovery == null
        ? {}
        : {
            isRetrying: recovery.retryingIds.has(sourceDocumentId),
            isCancelling: recovery.cancellingIds.has(sourceDocumentId),
            onRetry: recovery.retry,
            onCancelProcessing: recovery.cancelProcessing,
          })}
    />
  );
}

const UnifiedStreamItemRow = memo(function UnifiedStreamItemRow({
  item,
  mainCurrency,
  onViewLedgerEntry,
  onViewSourceDetail,
  onViewSourceDetailIntent,
  onEditRetry,
  onEditRetryIntent,
  onDeleteSourceConfirm,
  selectionMode,
  selected,
  selectionDisabled,
  onToggleSelection,
  defaultExpanded,
  expanded,
  onExpandedChange,
  isRetrying = false,
  isCancelling = false,
  onRetry,
  onCancelProcessing,
}: UnifiedStreamItemRowProps) {
  const sourceDocument = item.sourceDocument;
  const ledgerEntries = item.ledgerEntries;
  const handleExpandedChange = useCallback(
    (nextExpanded: boolean) => onExpandedChange?.(sourceDocument.id, nextExpanded),
    [onExpandedChange, sourceDocument.id]
  );
  const recoveryVariables = { sourceDocumentId: sourceDocument.id };

  return (
    <SourceDocumentCard
      sourceDocument={item.sourceDocument}
      ledgerEntries={item.ledgerEntries}
      mainCurrency={mainCurrency}
      {...(onViewLedgerEntry != null ? { onViewLedgerEntry } : {})}
      onViewDetails={() => onViewSourceDetail({ sourceDocument, ledgerEntries })}
      {...(onViewSourceDetailIntent != null
        ? { onViewDetailsIntent: () => onViewSourceDetailIntent(sourceDocument) }
        : {})}
      {...(onEditRetry != null ? { onEditRetry: () => onEditRetry(sourceDocument) } : {})}
      {...(onEditRetryIntent != null ? { onEditRetryIntent } : {})}
      onDelete={() => onDeleteSourceConfirm(sourceDocument)}
      selectionMode={selectionMode}
      isSelected={selected}
      selectionDisabled={selectionDisabled}
      onToggleSelect={() => onToggleSelection(sourceDocument.id)}
      defaultExpanded={defaultExpanded}
      {...(expanded === undefined ? {} : { expanded })}
      {...(onExpandedChange === undefined ? {} : { onExpandedChange: handleExpandedChange })}
      isRetrying={isRetrying}
      isCancelling={isCancelling}
      {...(onRetry == null ? {} : { onRetry: () => onRetry(recoveryVariables) })}
      {...(onCancelProcessing == null
        ? {}
        : { onCancelProcessing: () => onCancelProcessing(recoveryVariables) })}
    />
  );
});
