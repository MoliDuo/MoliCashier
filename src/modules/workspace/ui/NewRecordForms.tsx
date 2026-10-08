"use client";
import { useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { safePrefetch } from "@/lib/safe-prefetch";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { writeLastNewRecordBookId } from "../new-record-book-memory";
import { showNewRecordSuccessFeedback, type CommittedView } from "./new-record-success-feedback";

const SourceDocumentInput = dynamic(
  () =>
    import("@/modules/source-document/ui/SourceDocumentInput").then((m) => ({
      default: m.SourceDocumentInput,
    })),
  { ssr: false, loading: () => <InputFormLoadingFallback /> }
);
export function preloadNewRecordModules() {
  safePrefetch(
    import("@/modules/source-document/ui/SourceDocumentInput"),
    "PREFETCH_SOURCE_DOCUMENT_INPUT_FAILED"
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

export function InputFormLoadingFallback() {
  return (
    <div className="space-y-4 pt-1" role="status" aria-busy="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

interface NewRecordFormsProps {
  bookId: string;
  /** The book being viewed, or null for 总账. */
  viewedBookId: string | null;
  /** The book the record goes into, when it is resolvable in the live list. */
  savedBook: { id: string; name: string } | null;
  activeTab: LedgerTab;
  committedView: CommittedView;
  timeZone?: string;
  /** Closes the sheet once a record is saved. */
  onSaved: () => void;
  onPendingChange: (pending: boolean) => void;
  /** The record's book picker, shown in the form's footer. */
  bookPicker: ReactNode;
  /** The sheet's close control, at the end of the date row. */
  closeControl: ReactNode;
}

export function NewRecordForms({
  bookId,
  viewedBookId,
  savedBook,
  activeTab,
  committedView,
  timeZone,
  onSaved,
  onPendingChange,
  bookPicker,
  closeControl,
}: NewRecordFormsProps) {
  const handleSuccess = useCallback(
    (result: CreatedRecordResult) => {
      // Only a saved record counts as the picker's "last choice": a pick that
      // was changed and then cancelled must not become the next default.
      if (savedBook != null) writeLastNewRecordBookId(savedBook.id);

      showNewRecordSuccessFeedback({
        result,
        activeTab,
        committedView,
        viewedBookId,
        savedBook,
      });

      // A saved record closes the sheet.
      onSaved();
    },
    [activeTab, committedView, onSaved, savedBook, viewedBookId]
  );

  return (
    <div className="flex flex-col">
      <SourceDocumentInput
        bookId={bookId}
        footerStart={bookPicker}
        dateEnd={closeControl}
        onPendingChange={onPendingChange}
        {...(timeZone != null ? { timeZone } : {})}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
