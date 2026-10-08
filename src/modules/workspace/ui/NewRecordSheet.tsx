"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import { readLastNewRecordBookId } from "../new-record-book-memory";
import { NewRecordForms } from "./NewRecordForms";
import type { CommittedView } from "./new-record-success-feedback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ledgerPageCopy } from "@/copy/app";
import { bookPickerCopy, commonCopy } from "@/copy/common";

interface NewRecordSheetProps {
  /** Whether the URL names the sheet open (`?new=1`). */
  open: boolean;
  /** Closes it the way Back would; the URL then says it is closed. */
  onClose: () => void;
  /** The book being viewed, or null for 总账. */
  scope: RecordScope;
  /** The live books, for the record's book picker. */
  books: readonly BookDto[];
  activeTab: LedgerTab;
  committedView: CommittedView;
  /** The ledger's zone, which dates a new record by default. */
  timeZone: string;
}

/**
 * 记账: the new-record form as a sheet as tall as its content — at the bottom
 * of a phone's screen, centred from sm up — with no title, since what it is
 * for is plain. The date row carries the close control, and a footer pinned to
 * the bottom holds the book on the left and the submit on the right. Closing
 * it never asks: the form keeps its unsaved input as a draft and restores it
 * on the next opening.
 */
export function NewRecordSheet({
  open: isOpen,
  onClose,
  scope,
  books,
  activeTab,
  committedView,
  timeZone,
}: NewRecordSheetProps) {
  // The sheet opens from every tab, so the picker labels live in the shell
  // bundle instead of the 设置 one.
  // The shell's + button opens it from outside the page, so whether it is open
  // lives in the URL, where the system back gesture can close it.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleOpenChange = (open: boolean) => {
    if (!open && !isSubmitting) onClose();
  };
  // The picker opens on the book being viewed; on 总账 — no single book — it
  // opens on this device's last pick, then the first book in 设置 order. It is
  // a per-record choice: changing it does not move the view, and only a saved
  // record updates the memory.
  const [bookId, setBookId] = useState("");
  // Every opening starts the per-record pick over. A books refetch while the
  // sheet stays open must not overwrite what the user chose for this record,
  // so the pick is only reset on the closed-to-open edge.
  const [lastOpen, setLastOpen] = useState(isOpen);
  if (isOpen !== lastOpen) {
    setLastOpen(isOpen);
    if (isOpen) {
      const remembered = readLastNewRecordBookId();
      const isLive = (id: string | null): id is string =>
        id != null && books.some((book) => book.id === id);
      setBookId(isLive(scope) ? scope : isLive(remembered) ? remembered : (books[0]?.id ?? ""));
    }
  }
  // A pick whose book is no longer live (archived between the save and now,
  // say) resolves to the first book, so the picker and the submitted book
  // always agree with what the select shows.
  const selectedBook = books.find((book) => book.id === bookId) ?? books[0] ?? null;
  const selectedBookId = selectedBook?.id ?? "";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange} closeOnBack={false}>
      <DialogContent
        variant="sheet"
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:max-w-md"
        aria-describedby={undefined}
        hideCloseButton
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        {/* Named for assistive technology only; it also takes the first focus. */}
        <DialogTitle className="sr-only">{ledgerPageCopy.newRecord}</DialogTitle>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-6">
          <NewRecordForms
            bookId={selectedBookId}
            viewedBookId={scope}
            savedBook={selectedBook}
            activeTab={activeTab}
            committedView={committedView}
            onSaved={onClose}
            onPendingChange={setIsSubmitting}
            timeZone={timeZone}
            closeControl={
              isSubmitting ? null : (
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 text-muted-foreground sm:size-9"
                    aria-label={commonCopy.close}
                    title={commonCopy.close}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </DialogClose>
              )
            }
            bookPicker={
              <Select value={selectedBookId} onValueChange={setBookId} disabled={isSubmitting}>
                <SelectTrigger
                  className="w-full max-w-44"
                  aria-label={commonCopy.book}
                  title={commonCopy.book}
                >
                  <SelectValue placeholder={bookPickerCopy.namePlaceholder} />
                </SelectTrigger>
                <SelectContent position="popper" side="top">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
