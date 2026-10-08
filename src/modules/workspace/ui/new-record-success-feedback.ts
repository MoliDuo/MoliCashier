"use client";

import { toast } from "sonner";
import type { EntryFilters } from "@/modules/ledger/filters";
import type { CivilRange } from "@/modules/ledger/domain/period";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { openLedgerDetail } from "@/modules/ledger/navigation/ledger-detail-navigation";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";
import { sourceDocumentInputCopy } from "@/copy/source-document";

/** What 流水 is showing: its filters, and the days its period covers (null for all). */
export interface CommittedView {
  filters: EntryFilters;
  range: CivilRange | null;
}

interface SavedBook {
  id: string;
  name: string;
}

interface ShowNewRecordSuccessFeedbackOptions {
  result: CreatedRecordResult;
  activeTab: LedgerTab;
  committedView: CommittedView;
  /** The book being viewed, or null for 总账. */
  viewedBookId: string | null;
  /** The book the record went into, when it is known. */
  savedBook: SavedBook | null;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/**
 * A record saved into a book other than the one being viewed cannot appear in
 * the current view, no matter what the filters say.
 */
export function shouldWarnNewRecordSavedToOtherBook(
  viewedBookId: string | null,
  savedBook: SavedBook | null
): savedBook is SavedBook {
  return viewedBookId != null && savedBook != null && savedBook.id !== viewedBookId;
}

export function shouldWarnNewRecordMayBeHidden(
  activeTab: LedgerTab,
  committedView: CommittedView,
  entryDate: string
): boolean {
  if (activeTab !== "records" && activeTab !== "entries") return true;
  const committedFilters = committedView.filters;

  if (
    (committedFilters.search != null && committedFilters.search !== "") ||
    (committedFilters.statuses?.length ?? 0) > 0 ||
    (committedFilters.categoryId != null && committedFilters.categoryId !== "") ||
    (committedFilters.currency != null && committedFilters.currency !== "") ||
    committedFilters.minAmount != null ||
    committedFilters.maxAmount != null
  ) {
    return true;
  }

  const submittedDate = dateOnly(entryDate);
  const range = committedView.range;
  return range != null && (submittedDate < range.from || submittedDate > range.to);
}

export function showNewRecordSuccessFeedback({
  result,
  activeTab,
  committedView,
  viewedBookId,
  savedBook,
}: ShowNewRecordSuccessFeedbackOptions): void {
  if (shouldWarnNewRecordSavedToOtherBook(viewedBookId, savedBook)) {
    toast.success(sourceDocumentInputCopy.savedToOtherBook({ book: savedBook.name }), {
      action: {
        label: sourceDocumentInputCopy.viewRecord,
        onClick: () => openLedgerDetail(result.sourceDocumentId),
      },
    });
    return;
  }

  if (shouldWarnNewRecordMayBeHidden(activeTab, committedView, result.documentDate)) {
    toast.success(sourceDocumentInputCopy.savedMayBeHidden, {
      action: {
        label: sourceDocumentInputCopy.viewRecord,
        onClick: () => openLedgerDetail(result.sourceDocumentId),
      },
    });
    return;
  }

  toast.success(sourceDocumentInputCopy.uploadSuccess);
}
