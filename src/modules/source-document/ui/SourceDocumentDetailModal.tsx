"use client";
import type { BookDto, EntryCategory } from "@/modules/ledger/contracts";
import { useMemo, useRef, useState } from "react";
import { CircleStop, FilePen, MoreVertical, RefreshCw, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditableField } from "@/components/ui/editable-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { textRoleClassName } from "@/components/typography";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { LedgerEntriesBatchActionToolbar } from "@/modules/ledger/ui/batch-action-toolbar";
import { useSourceDocumentDetail } from "@/modules/source-document/hooks/useSourceDocumentDetail";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentViewDetails } from "./SourceDocumentViewDetails";
import { SourceDocumentTotal } from "./SourceDocumentViewDetails/components/SourceDocumentTotal";
import { SourceDocumentDetailStatusPanels } from "./SourceDocumentDetailStatusPanels";
import { SourceDocumentDetailConfirmDialogs } from "./SourceDocumentDetailConfirmDialogs";
import { SourceDocumentEditRetryDialog } from "./SourceDocumentEditRetryDialog";
import { SourceDocumentSplitDialog } from "./SourceDocumentSplitDialog";
import { AddLedgerEntryDialog } from "./AddLedgerEntryDialog";
import { buildSourceDocumentDetailViewModel } from "./source-document-detail-view-model";
import { commonCopy } from "@/copy/common";
import {
  sourceDocumentActionCopy,
  sourceDocumentCardCopy,
  sourceDocumentDetailCopy,
} from "@/copy/source-document";

interface SourceDocumentDetailModalProps {
  /** The live books, so this record's own book can be changed here. */
  books: readonly BookDto[];
  id: string;
  open: boolean;
  onClose: () => void;
  /** Called once the sheet has finished closing. */
  onExitComplete?: () => void;
  categories: EntryCategory[];
  mainCurrency: string;
  preferredCurrencies: string[];
  /** Ledger timezone, so dates are named the ledger's way. */
  timeZone?: string;
}

function evidenceCount(sourceDocument: SourceDocument): number {
  const hasText = sourceDocument.text != null && sourceDocument.text.trim() !== "";
  return sourceDocument.files.length + (hasText ? 1 : 0);
}

interface DetailMenuProps {
  sourceDocument: SourceDocument;
  disabled: boolean;
  isRetrying: boolean;
  isCancelling: boolean;
  onRetry: () => void;
  onEditRetry: () => void;
  onCancelProcessing: () => void;
  onDelete: () => void;
}

/** The record's own commands, in the order and with the icons the stream card uses. */
function DetailMenu({
  sourceDocument,
  disabled,
  isRetrying,
  isCancelling,
  onRetry,
  onEditRetry,
  onCancelProcessing,
  onDelete,
}: DetailMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const has = (action: SourceDocument["supportedActions"][number]) =>
    sourceDocument.supportedActions.includes(action);
  const hasRecovery = has("retry") || has("edit_retry") || has("cancel_processing");

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={sourceDocumentCardCopy.moreActions}
          title={sourceDocumentCardCopy.moreActions}
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        {has("retry") && (
          <DropdownMenuItem onClick={onRetry} disabled={isRetrying}>
            <RefreshCw className={cn("mr-2 size-4", isRetrying && "animate-spin")} />
            {sourceDocumentActionCopy.retry}
          </DropdownMenuItem>
        )}
        {has("edit_retry") && (
          <DropdownMenuItem onClick={onEditRetry}>
            <FilePen className="mr-2 size-4" />
            {sourceDocumentActionCopy.editRetry}
          </DropdownMenuItem>
        )}
        {has("cancel_processing") && (
          <DropdownMenuItem onClick={onCancelProcessing} disabled={isCancelling}>
            <CircleStop className="mr-2 size-4" />
            {sourceDocumentActionCopy.cancelProcessing}
          </DropdownMenuItem>
        )}
        {hasRecovery && has("delete") && <DropdownMenuSeparator />}
        {has("delete") && (
          <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
            <Trash2 className="mr-2 size-4" />
            {sourceDocumentDetailCopy.deleteDocument}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceDocumentDetailSheet({
  books,
  id,
  open,
  onClose,
  onExitComplete,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
}: SourceDocumentDetailModalProps) {
  const detail = useSourceDocumentDetail({ id, open, books, onClose });
  const { sourceDocument, ledgerEntries, pendingEntries, selection, status, dialogs, actions } =
    detail;
  const [dateAdjustmentActive, setDateAdjustmentActive] = useState(false);
  // Narrow screens show one pane at a time; desktop shows both side by side.
  const [mobileView, setMobileView] = useState<"details" | "evidence">("details");
  const evidence = sourceDocument == null ? 0 : evidenceCount(sourceDocument);

  const savedDate = sourceDocument?.documentDate ?? "";
  const { totalInMainCurrency, unconvertedCount, staleConversionCount } = useMemo(
    () =>
      buildSourceDocumentDetailViewModel({
        ledgerEntries,
        pendingChanges: { entries: pendingEntries },
        mainCurrency,
        entryDate: detail.documentDate,
        originalEntryDate: savedDate,
      }),
    [detail.documentDate, ledgerEntries, mainCurrency, pendingEntries, savedDate]
  );

  // Selection takes over the entries card's header row, so the batch actions
  // sit right above the rows they act on.
  const selectionToolbar = selection.isSelectionMode ? (
    <LedgerEntriesBatchActionToolbar
      selectedCount={selection.selectedIds.length}
      loadedCount={ledgerEntries.length}
      isAllSelected={selection.isAllSelected}
      onSelectAll={() => selection.handleSelectAll(true)}
      onClearSelection={() => selection.handleSelectAll(false)}
      onChangeCategory={actions.batchCategory}
      onChangeCurrency={actions.batchCurrency}
      {...(sourceDocument?.supportedActions.includes("split_entries") === true
        ? { onSplit: actions.openSplit }
        : {})}
      onDelete={actions.openBatchDelete}
      categories={categories}
      preferredCurrencies={preferredCurrencies}
      isChangingCategory={status.isBatchUpdating}
      isChangingCurrency={status.isBatchUpdating}
      isProcessing={status.busy}
    />
  ) : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !value && onClose()} closeOnBack={false}>
        <DialogContent
          variant="detail"
          {...(onExitComplete !== undefined ? { onExitComplete } : {})}
          className="flex flex-col gap-0 overflow-hidden p-0 lg:h-[90dvh] lg:max-w-[1200px]"
          aria-describedby={undefined}
          hideCloseButton
        >
          <DialogHeader className="shrink-0 flex-row items-center gap-2 space-y-0 border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-3">
            <DialogTitle asChild>
              <div className="min-w-0 flex-1">
                <EditableField
                  value={detail.title}
                  onChange={(title) => void actions.updateDocument({ title })}
                  placeholder={sourceDocumentDetailCopy.untitled}
                  displayClassName={textRoleClassName("sectionTitle", "truncate")}
                  inputClassName={textRoleClassName("sectionTitle")}
                  disabled={status.readOnly || status.isSavingDocument}
                  inputAriaLabel={sourceDocumentDetailCopy.titleLabel}
                />
              </div>
            </DialogTitle>
            {sourceDocument != null ? (
              <DetailMenu
                sourceDocument={sourceDocument}
                disabled={status.busy}
                isRetrying={status.isRetrying}
                isCancelling={status.isCancelling}
                onRetry={() => void actions.retry()}
                onEditRetry={actions.openEditRetry}
                onCancelProcessing={() => void actions.cancelProcessing()}
                onDelete={actions.requestDeleteDocument}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={commonCopy.close}
              title={commonCopy.close}
            >
              <X className="size-4" />
            </Button>
          </DialogHeader>

          {sourceDocument != null ? (
            <div
              data-testid="source-document-date-row"
              className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 sm:px-5"
            >
              <span className="sr-only">{sourceDocumentDetailCopy.transactionTime}</span>
              <DateFilter
                value={detail.documentDate}
                onChange={(date) => {
                  if (date != null) {
                    void actions.updateDocument({ documentDate: formatDateTimeForApi(date) });
                  }
                }}
                size="sm"
                className="min-w-fit shrink-0"
                truncate={false}
                showClear={false}
                showClearShortcut={false}
                readOnly={status.readOnly}
                disabled={status.isSavingDocument}
                readOnlyTextClassName="font-medium"
                hideReadOnlyIcon
              />
              {sourceDocument.bookId != null && books.length > 0 ? (
                <Select
                  value={sourceDocument.bookId}
                  onValueChange={detail.assignBook}
                  disabled={status.readOnly || detail.isAssigningBook}
                >
                  <SelectTrigger
                    className="h-8 w-auto min-w-28 max-w-40"
                    aria-label={commonCopy.book}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {books.map((book) => (
                      <SelectItem key={book.id} value={book.id}>
                        {book.name}
                      </SelectItem>
                    ))}
                    {detail.archivedBookLabel != null ? (
                      <SelectItem value={sourceDocument.bookId}>
                        {detail.archivedBookLabel}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              ) : null}
              <div className="ml-auto">
                <SourceDocumentTotal
                  totalInMainCurrency={totalInMainCurrency}
                  mainCurrency={mainCurrency}
                  staleConversionCount={staleConversionCount}
                  unconvertedCount={unconvertedCount}
                />
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 lg:flex lg:flex-col lg:overflow-hidden">
            <div className="shrink-0">
              <SourceDocumentDetailStatusPanels
                sourceDocument={sourceDocument}
                loadError={detail.loadError}
                isLoading={detail.isLoading}
                isReloading={detail.isReloading}
                onClose={onClose}
                onReload={detail.reload}
              />
              {status.isProcessing ? (
                <p role="status" className={textRoleClassName("meta", "mb-3 px-1")}>
                  {sourceDocumentDetailCopy.processingReadOnly}
                </p>
              ) : null}
              {evidence > 0 ? (
                <SegmentedControl
                  className="mb-3 lg:hidden"
                  label={sourceDocumentDetailCopy.rawEvidence}
                  value={mobileView}
                  onChange={setMobileView}
                  options={[
                    { value: "details", label: sourceDocumentDetailCopy.entriesTab },
                    {
                      value: "evidence",
                      label: sourceDocumentDetailCopy.evidenceTab({ count: evidence }),
                    },
                  ]}
                />
              ) : null}
            </div>

            {sourceDocument && (
              <div className="min-h-0 lg:flex-1">
                <SourceDocumentViewDetails
                  sourceDocument={sourceDocument}
                  ledgerEntries={ledgerEntries}
                  pendingEntries={pendingEntries}
                  savingEntryIds={status.savingEntryIds}
                  documentDate={detail.documentDate}
                  categories={categories}
                  preferredCurrencies={preferredCurrencies}
                  mainCurrency={mainCurrency}
                  selectedEntryIds={selection.selectedIds}
                  isSelectionMode={selection.isSelectionMode}
                  onEntryChange={(entryId, changes) => void actions.updateEntry(entryId, changes)}
                  onSelectEntry={selection.handleSelect}
                  onToggleSelectionMode={() =>
                    !dateAdjustmentActive && actions.toggleSelectionMode()
                  }
                  readOnly={status.readOnly}
                  isAddingEntry={status.isAddingEntry}
                  onAddEntry={actions.openAddEntry}
                  onDeleteEntry={actions.requestDeleteEntry}
                  onApplyDateOrganization={detail.applyDateOrganization}
                  onDismissDateOrganization={detail.dismissDateOrganization}
                  onApplyDuplicateSuggestion={detail.applyDuplicateSuggestion}
                  onDismissDuplicateSuggestion={detail.dismissDuplicateSuggestion}
                  isResolvingDuplicates={detail.isResolvingDuplicates}
                  isOrganizingDates={detail.isOrganizingDates}
                  dateOrganizationDisabled={selection.isSelectionMode}
                  {...(timeZone != null ? { timeZone } : {})}
                  mobileView={mobileView}
                  onDateAdjustmentStateChange={(active, dirty) => {
                    setDateAdjustmentActive(active || dirty);
                  }}
                  {...(selectionToolbar != null ? { selectionToolbar } : {})}
                />
              </div>
            )}
          </div>
        </DialogContent>

        <SourceDocumentDetailConfirmDialogs
          showBatchDeleteConfirm={dialogs.showBatchDeleteConfirm}
          setShowBatchDeleteConfirm={dialogs.setShowBatchDeleteConfirm}
          selectedCount={selection.selectedIds.length}
          handleBatchDelete={actions.batchDelete}
          pendingDeleteEntryId={dialogs.pendingDeleteEntryId}
          setPendingDeleteEntryId={dialogs.setPendingDeleteEntryId}
          handleDeleteEntry={actions.deleteEntry}
          showDeleteConfirm={dialogs.showDeleteConfirm}
          setShowDeleteConfirm={dialogs.setShowDeleteConfirm}
          handleDeleteDocument={actions.deleteDocument}
        />
      </Dialog>
      {sourceDocument != null ? (
        <SourceDocumentEditRetryDialog
          sourceDocument={sourceDocument}
          open={dialogs.showRetryDialog}
          onOpenChange={dialogs.setShowRetryDialog}
          onPendingChange={status.setIsEditRetrying}
          onSuccess={() => dialogs.setShowRetryDialog(false)}
        />
      ) : null}
      {dialogs.showSplitDialog ? (
        <SourceDocumentSplitDialog
          open
          selectedEntries={ledgerEntries.filter((entry) =>
            selection.selectedIds.includes(entry.id)
          )}
          initialDate={savedDate || (sourceDocument?.createdAt.slice(0, 10) ?? "")}
          isSubmitting={status.isSplitting}
          onOpenChange={dialogs.setShowSplitDialog}
          onSubmit={actions.split}
          {...(timeZone != null ? { timeZone } : {})}
        />
      ) : null}
      {dialogs.showAddEntryDialog ? (
        <AddLedgerEntryDialog
          open
          categories={categories}
          preferredCurrencies={preferredCurrencies}
          mainCurrency={mainCurrency}
          isSubmitting={status.isAddingEntry}
          onOpenChange={dialogs.setShowAddEntryDialog}
          onSubmit={actions.addEntry}
        />
      ) : null}
    </>
  );
}

export function SourceDocumentDetailModal(props: SourceDocumentDetailModalProps) {
  return <SourceDocumentDetailSheet key={props.id} {...props} />;
}
