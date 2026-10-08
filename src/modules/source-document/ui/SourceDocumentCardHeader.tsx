import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type {
  SourceDocumentDetailDto,
  SourceDocumentListItemDto,
} from "@/modules/source-document/contracts";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { SupportedSourceDocumentAction } from "@/modules/source-document/lifecycle";
import { memo, useRef } from "react";
import { ChevronDown, CircleStop, FilePen, MoreVertical, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import { ProcessingStatus } from "./processing-status";
import { SourceDocumentCardTotal } from "./SourceDocumentCardTotal";
import { diagnosticLabel } from "./diagnostic-messages";
import { commonCopy } from "@/copy/common";
import {
  diagnosticCodeCopy,
  sourceDocumentActionCopy,
  sourceDocumentCardCopy,
} from "@/copy/source-document";

interface SourceDocumentCardHeaderProps {
  sourceDocument: SourceDocumentDetailDto | SourceDocumentListItemDto;
  ledgerEntries: LedgerEntryDto[];
  mainCurrency: string;
  isRetrying: boolean;
  isCancelling: boolean;
  selectionMode: boolean;
  supportedActions: readonly SupportedSourceDocumentAction[];
  showActions?: boolean;
  isExpanded: boolean;
  hasExpandableContent?: boolean;
  contentId: string;
  onToggleExpanded: () => void;
  onViewDetails?: (() => void) | undefined;
  onViewDetailsIntent?: (() => void) | undefined;
  onDirectRetry?: (() => void | Promise<void>) | undefined;
  onCancelProcessing?: (() => void | Promise<void>) | undefined;
  onEditRetry?: (() => void | Promise<void>) | undefined;
  onEditRetryIntent?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

function getProcessingStatus(status: SourceDocumentProcessingStatus | null) {
  if (status === "failed") {
    return "error" as const;
  }

  if (status === "processing" || status === "completed" || status === "cancelled") {
    return status;
  }

  return null;
}

/**
 * Where the card surface puts its selection-mode expand control so it lands on
 * this header's chevron column. The surface positions against the card's outer
 * edge, so each offset adds back the card's 1px border, and centres its 44px
 * button on the 36px chevron (4px in from either side).
 *
 * With the menu, the chevron's right edge is 56px in at both sizes: `pr-2` +
 * 36px menu + `ml-1` + `gap-2` on a phone, `pr-3` + 32px + 4px + 8px from `sm`.
 * Without it, the chevron ends the row, one `pr-2` / `pr-3` in.
 */
export const SELECTION_EXPAND_POSITION = {
  withMenu: "right-[calc(3.25rem+1px)]",
  withoutMenu: "right-[calc(0.25rem+1px)] sm:right-[calc(0.5rem+1px)]",
} as const;

export const SourceDocumentCardHeader = memo(function SourceDocumentCardHeader({
  sourceDocument,
  ledgerEntries,
  mainCurrency,
  isRetrying,
  isCancelling,
  selectionMode,
  supportedActions,
  showActions = true,
  isExpanded,
  hasExpandableContent = true,
  contentId,
  onToggleExpanded,
  onViewDetails,
  onViewDetailsIntent,
  onDirectRetry,
  onCancelProcessing,
  onEditRetry,
  onEditRetryIntent,
  onDelete,
}: SourceDocumentCardHeaderProps) {
  const { processingStatus: status, failureKind, errorCode } = sourceDocument;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const processingStatus = getProcessingStatus(status);
  // The card's surface says which state the document is in, so the only state
  // worth words here is a failure, which has to name its reason. Everything
  // else is announced to assistive tech and left unprinted.
  const shouldAnnounceStatus = processingStatus != null;
  const shouldShowTotal = ledgerEntries.length > 0;
  // Suggestions wait inside the record, so the card says there is one to see.
  const pendingSuggestions =
    "pendingSuggestions" in sourceDocument ? sourceDocument.pendingSuggestions : [];

  // A failed document shows one stable label: a document the AI could not turn
  // into entries reads as unparsable, everything else by its failure code. The
  // AI-written reason is too long for this badge and lives in the detail panel.
  const failureLabel =
    status === "failed"
      ? failureKind === "invalid_input"
        ? diagnosticCodeCopy.unparsableDocument
        : diagnosticLabel(errorCode ?? "processing_unavailable")
      : null;

  const hasAction = (action: SupportedSourceDocumentAction) => supportedActions.includes(action);

  return (
    <div
      // The shell's 56px minimum is measured over its own 1px top and bottom
      // borders, so a header filling the full 56px would push a collapsed card
      // to 58px — 2px taller than the single-row entry cards it sits beside in
      // the details tab. What is left is one entry row's height, which is the
      // point: this header carries less than a row does.
      //
      // The title leads, then what the bill is in, then its total; the chevron
      // and the menu close the row. Selection is the card's outline, so nothing
      // takes a control's place and the title never shifts entering it.
      // `SELECTION_EXPAND_POSITION` below is measured off this padding and the
      // menu's size; change them together.
      className="flex h-[calc(var(--selectable-card-header-height,56px)-2px)] items-center gap-1 py-2 pl-1 pr-2 sm:pl-2 sm:pr-3"
    >
      <button
        type="button"
        onClick={onViewDetails}
        onPointerEnter={onViewDetailsIntent}
        onPointerDown={onViewDetailsIntent}
        onFocus={onViewDetailsIntent}
        disabled={onViewDetails == null}
        className="group flex min-h-9 min-w-0 flex-1 items-center rounded-md px-2 py-1 text-left transition-[color,background-color] duration-[var(--motion-feedback)] focus-visible:outline-none disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-2 rounded-sm group-focus-visible:outline-2 group-focus-visible:-outline-offset-2 group-focus-visible:outline-ring">
          <span className={textRoleClassName("cardTitle", "truncate")}>
            {sourceDocument.title?.trim() || sourceDocumentCardCopy.untitled}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        {pendingSuggestions.includes("duplicate") && (
          <span className={textRoleClassName("micro", "whitespace-nowrap text-warning")}>
            {sourceDocumentCardCopy.pendingDuplicate}
          </span>
        )}
        {pendingSuggestions.includes("date_organization") && (
          <span className={textRoleClassName("micro", "whitespace-nowrap text-info")}>
            {sourceDocumentCardCopy.pendingDateOrganization}
          </span>
        )}
        {shouldAnnounceStatus && (
          <ProcessingStatus
            status={processingStatus}
            {...(failureLabel != null ? { label: failureLabel } : {})}
          />
        )}

        {shouldShowTotal && (
          <div className="text-right">
            <SourceDocumentCardTotal entries={ledgerEntries} mainCurrency={mainCurrency} />
          </div>
        )}
        {hasExpandableContent && selectionMode ? (
          // The surface draws the live control on this column while selecting;
          // this keeps the room so the total stays where it was.
          <span aria-hidden="true" className="h-9 w-9 shrink-0" />
        ) : hasExpandableContent ? (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color] duration-[var(--motion-feedback)] hover:text-text"
            aria-label={
              isExpanded ? sourceDocumentCardCopy.collapse : sourceDocumentCardCopy.expand
            }
            aria-expanded={isExpanded}
            aria-controls={contentId}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-[var(--motion-feedback)] ease-[var(--motion-state-ease)]",
                isExpanded && "rotate-180"
              )}
            />
          </button>
        ) : null}

        {showActions && (
          <div
            className="ml-1 flex items-center gap-1.5"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuTriggerRef}
                  variant="ghost"
                  size="icon-sm"
                  className="h-9 w-9 text-muted-foreground hover:text-text sm:h-8 sm:w-8"
                  aria-label={sourceDocumentCardCopy.moreActions}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-44"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  menuTriggerRef.current?.focus();
                }}
              >
                {/* Recovery actions for invalid/failed */}
                {hasAction("retry") && onDirectRetry != null && (
                  <DropdownMenuItem onClick={onDirectRetry} disabled={isRetrying}>
                    <RefreshCw className={cn("mr-2 h-4 w-4", isRetrying && "animate-spin")} />
                    {sourceDocumentActionCopy.retry}
                  </DropdownMenuItem>
                )}
                {hasAction("edit_retry") && onEditRetry != null && (
                  <DropdownMenuItem
                    onClick={onEditRetry}
                    onPointerEnter={onEditRetryIntent}
                    onFocus={onEditRetryIntent}
                  >
                    <FilePen className="mr-2 h-4 w-4" />
                    {sourceDocumentActionCopy.editRetry}
                  </DropdownMenuItem>
                )}

                {hasAction("cancel_processing") && onCancelProcessing != null && (
                  <DropdownMenuItem onClick={onCancelProcessing} disabled={isCancelling}>
                    <CircleStop className="mr-2 h-4 w-4" />
                    {sourceDocumentActionCopy.cancelProcessing}
                  </DropdownMenuItem>
                )}

                {hasAction("retry") && onDelete != null && <DropdownMenuSeparator />}

                {onDelete != null && (
                  <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
                    <Trash2 className="mr-2 h-4 w-4" />
                    {commonCopy.delete}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
});
