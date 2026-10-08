import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type {
  SourceDocumentDetailDto,
  SourceDocumentListItemDto,
} from "@/modules/source-document/contracts";
import { memo, useCallback, useId, useMemo, useState } from "react";
import { type SourceDocumentProcessingStatus } from "@/modules/source-document/contracts";
import type { SupportedSourceDocumentAction } from "@/modules/source-document/lifecycle";
import { EntryCardShell, type EntryCardTone } from "@/components/entry-card-shell";
import { SelectableCardSurface } from "@/components/selectable-card-surface";
import { SELECTION_EXPAND_POSITION, SourceDocumentCardHeader } from "./SourceDocumentCardHeader";
import { sortSourceDocumentEntries } from "./source-document-card.utils";
import { SourceDocumentCardEntries } from "./SourceDocumentCardEntries";
import { ProcessingSweep } from "./processing-sweep";
import { commonCopy } from "@/copy/common";
import { sourceDocumentCardCopy } from "@/copy/source-document";

const cardToneByStatus: Record<SourceDocumentProcessingStatus, EntryCardTone> = {
  processing: "busy",
  failed: "danger",
  cancelled: "muted",
  completed: "default",
};

interface SourceDocumentCardProps {
  sourceDocument: SourceDocumentDetailDto | SourceDocumentListItemDto;
  ledgerEntries: LedgerEntryDto[];
  mainCurrency?: string;
  onDelete?: () => void;
  onViewLedgerEntry?: (ledgerEntry: LedgerEntryDto) => void;
  onViewDetails?: () => void;
  onViewDetailsIntent?: () => void;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onEditRetry?: () => void | Promise<void>;
  onEditRetryIntent?: () => void;
  className?: string;
  selectionMode?: boolean;
  isSelected?: boolean;
  selectionDisabled?: boolean;
  onToggleSelect?: () => void;
  readOnly?: boolean;
  isRetrying?: boolean;
  isCancelling?: boolean;
  onRetry?: () => void | Promise<void>;
  onCancelProcessing?: () => void | Promise<void>;
}

export const SourceDocumentCard = memo(function SourceDocumentCard(props: SourceDocumentCardProps) {
  return <SourceDocumentCardBody {...props} />;
});

function SourceDocumentCardBody({
  sourceDocument,
  ledgerEntries,
  mainCurrency = "CNY",
  onDelete,
  onViewLedgerEntry,
  onViewDetails,
  onViewDetailsIntent,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  onEditRetry,
  onEditRetryIntent,
  className,
  selectionMode = false,
  isSelected = false,
  selectionDisabled = false,
  onToggleSelect,
  readOnly = false,
  isRetrying = false,
  isCancelling = false,
  onRetry,
  onCancelProcessing,
}: SourceDocumentCardProps) {
  const { processingStatus } = sourceDocument;
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? localExpanded;
  const toggleExpanded = useCallback(() => {
    const next = !isExpanded;
    if (expanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  }, [expanded, isExpanded, onExpandedChange]);
  const contentId = `source-document-card-${useId().replaceAll(":", "")}`;
  const sortedEntries = useMemo(() => sortSourceDocumentEntries(ledgerEntries), [ledgerEntries]);
  const hasExpandableContent = sortedEntries.length > 0;
  const supportedActions: readonly SupportedSourceDocumentAction[] = readOnly
    ? []
    : sourceDocument.supportedActions;
  // The card itself carries the state: green and working, red and failed, grey
  // and inert. Anything else (a finished document, one with no submission in
  // flight) keeps the neutral surface every card starts from.
  const cardTone = processingStatus == null ? "default" : cardToneByStatus[processingStatus];

  return (
    <SelectableCardSurface
      selectionMode={selectionMode}
      selected={isSelected}
      disabled={selectionDisabled}
      selectionLabel={commonCopy.selectItem({
        item: sourceDocument.title?.trim() || sourceDocumentCardCopy.untitled,
      })}
      onToggleSelection={() => onToggleSelect?.()}
      expandable={
        hasExpandableContent
          ? {
              isExpanded,
              onToggleExpanded: toggleExpanded,
              expandLabel: isExpanded
                ? sourceDocumentCardCopy.collapse
                : sourceDocumentCardCopy.expand,
              contentId,
              positionClassName: readOnly
                ? SELECTION_EXPAND_POSITION.withoutMenu
                : SELECTION_EXPAND_POSITION.withMenu,
            }
          : undefined
      }
    >
      <EntryCardShell
        data-testid="source-document-card-root"
        data-source-document-id={sourceDocument.id}
        selected={selectionMode && isSelected}
        interactive={selectionMode}
        tone={cardTone}
        className={className}
      >
        {processingStatus === "processing" ? <ProcessingSweep /> : null}
        <SourceDocumentCardHeader
          sourceDocument={sourceDocument}
          ledgerEntries={ledgerEntries}
          mainCurrency={mainCurrency}
          isRetrying={isRetrying}
          isCancelling={isCancelling}
          selectionMode={selectionMode}
          supportedActions={supportedActions}
          showActions={!readOnly}
          isExpanded={isExpanded}
          hasExpandableContent={hasExpandableContent}
          contentId={contentId}
          onToggleExpanded={toggleExpanded}
          onViewDetails={onViewDetails}
          onViewDetailsIntent={onViewDetailsIntent}
          onDirectRetry={onRetry}
          onCancelProcessing={onCancelProcessing}
          onEditRetry={onEditRetry}
          onEditRetryIntent={onEditRetryIntent}
          onDelete={onDelete}
        />
        {isExpanded && hasExpandableContent ? (
          <div
            id={contentId}
            data-testid="source-document-card-body"
            className="animate-in overflow-hidden fade-in-0 slide-in-from-top-1 duration-[var(--motion-expand)] ease-[var(--motion-state-ease)] motion-reduce:animate-none"
          >
            <SourceDocumentCardEntries
              entries={sortedEntries}
              mainCurrency={mainCurrency}
              sourceDocumentEntryDate={sourceDocument.documentDate}
              {...(onViewLedgerEntry != null ? { onViewLedgerEntry } : {})}
            />
          </div>
        ) : null}
      </EntryCardShell>
    </SelectableCardSurface>
  );
}
