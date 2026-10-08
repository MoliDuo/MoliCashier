"use client";

import { useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentSplitDialogProps {
  open: boolean;
  selectedEntries?: LedgerEntryDto[];
  selectedCount?: number;
  initialDate: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (entryDate: string) => Promise<void>;
  /** Ledger timezone, so 今天/昨天 name the ledger's day rather than the device's. */
  timeZone?: string;
}

export function SourceDocumentSplitDialog({
  open,
  selectedEntries = [],
  selectedCount,
  initialDate,
  isSubmitting,
  onOpenChange,
  onSubmit,
  timeZone,
}: SourceDocumentSplitDialogProps) {
  const locale = DISPLAY_LOCALE;
  const [entryDate, setEntryDate] = useState(() => initialDate);
  const previewEntries = selectedEntries.slice(0, 5);
  const remainingCount = selectedEntries.length - previewEntries.length;
  const totalSelected = selectedCount ?? selectedEntries.length;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent
        variant="modal"
        className="sm:max-w-md"
        hideCloseButton={isSubmitting}
        onEscapeKeyDown={(event) => isSubmitting && event.preventDefault()}
        onPointerDownOutside={(event) => isSubmitting && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-4" />
            {sourceDocumentDetailCopy.splitTitle}
          </DialogTitle>
        </DialogHeader>
        <p className={textRoleClassName("bodyMuted")}>
          {sourceDocumentDetailCopy.splitDescription({ count: totalSelected })}
        </p>
        <ul className="divide-y rounded-lg border">
          {previewEntries.map((entry) => (
            <li
              key={entry.id}
              className={textRoleClassName(
                "body",
                "flex items-center justify-between gap-3 px-3 py-2"
              )}
            >
              <span className="min-w-0 truncate">{entry.itemName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCurrencyAmount(entry.amount, entry.currency ?? "CNY", locale)}
              </span>
            </li>
          ))}
        </ul>
        {remainingCount > 0 ? (
          <p className={textRoleClassName("meta")}>
            {sourceDocumentDetailCopy.splitMore({ count: remainingCount })}
          </p>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="split-entry-date">{sourceDocumentDetailCopy.splitDate}</Label>
          {/* The same picker every other date field uses, so 今天/昨天 and the
              month grid are learned once. */}
          <DateFilter
            value={entryDate}
            onChange={(date) => {
              if (date != null) setEntryDate(formatDateTimeForApi(date));
            }}
            className="w-full"
            showClear={false}
            showClearShortcut={false}
            disabled={isSubmitting}
            ariaLabel={sourceDocumentDetailCopy.splitDate}
            {...(timeZone != null ? { timeZone } : {})}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
            {commonCopy.cancel}
          </Button>
          <Button
            disabled={isSubmitting || entryDate === ""}
            onClick={() => void onSubmit(entryDate)}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Scissors className="size-4" />
            )}
            {sourceDocumentDetailCopy.splitTitle}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
