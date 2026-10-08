"use client";

import { writeLedgerHistory } from "@/modules/ledger/navigation/ledger-history";
import { LEDGER_NEW_RECORD_PARAM } from "@/modules/ledger/navigation/ledger-new-record-navigation";
import { leavePastOverlays } from "@/lib/navigation/overlay-history";

/** The open record, as `?detail=<id>` on whichever ledger route it was opened from. */
export const LEDGER_DETAIL_PARAM = "detail";

export function readLedgerDetailParam(params: Pick<URLSearchParams, "get">): string | null {
  const id = params.get(LEDGER_DETAIL_PARAM);
  return id == null || id === "" ? null : id;
}

function detailUrl(id: string | null): string {
  const params = new URLSearchParams(window.location.search);
  // A record opened from 记账's success toast replaces nothing of the sheet:
  // the sheet has closed, even if its Back has not landed yet.
  params.delete(LEDGER_NEW_RECORD_PARAM);
  if (id == null) params.delete(LEDGER_DETAIL_PARAM);
  else params.set(LEDGER_DETAIL_PARAM, id);
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

/** Whether the current history entry is one a detail sheet pushed. */
function detailWasPushed(): boolean {
  const state = window.history.state as { cashier?: { kind?: string } } | null;
  return state?.cashier?.kind === "detail";
}

// The control that opened the sheet, so closing it puts focus back there. It
// is interface state only; the URL stays the one record of what is open.
let returnFocusTarget: HTMLElement | null = null;

/**
 * Opens a record. A sheet already open is replaced rather than stacked, so
 * closing always lands back on the list it was opened from.
 */
export function openLedgerDetail(id: string): void {
  const current = readLedgerDetailParam(new URLSearchParams(window.location.search));
  if (current == null) {
    returnFocusTarget =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    writeLedgerHistory("push", detailUrl(id), "detail");
    return;
  }
  if (current === id) return;
  writeLedgerHistory("replace", detailUrl(id), detailWasPushed() ? "detail" : "filter");
}

/**
 * A ledger entry has no detail sheet of its own, so opening one lands on the
 * record it belongs to — the sheet the stream card opens. Entries are stored
 * with a source document, so the guard only covers a malformed payload.
 */
export function openLedgerEntrySourceDocument(entry: { sourceDocumentId: string | null }): void {
  if (entry.sourceDocumentId == null || entry.sourceDocumentId === "") return;
  openLedgerDetail(entry.sourceDocumentId);
}

/**
 * Closes the open record the way Back would: an entry the sheet pushed is
 * popped, and a sheet reached by a link has its parameter replaced away.
 */
export function closeLedgerDetail(): void {
  if (readLedgerDetailParam(new URLSearchParams(window.location.search)) == null) return;
  const replaceAway = () => writeLedgerHistory("replace", detailUrl(null), "filter");
  if (detailWasPushed()) {
    // Dialogs still open on the sheet (a delete confirmation) leave with it.
    if (!leavePastOverlays(1)) window.history.back();
    return;
  }
  if (!leavePastOverlays(0, replaceAway)) replaceAway();
}

/**
 * Hands focus back to the control that opened the sheet, once it has gone —
 * unless the reader has already moved on. The sheet finishes leaving a moment
 * after it stops answering, and a reader who tabbed to the gear in that moment
 * would otherwise have focus pulled out from under the key they then press.
 */
export function restoreDetailReturnFocus(): void {
  const target = returnFocusTarget;
  returnFocusTarget = null;
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.isConnected &&
      active.closest('[role="dialog"]') == null
    ) {
      return;
    }
    if (target?.isConnected === true) target.focus();
    else document.querySelector<HTMLElement>("[data-ledger-focus-fallback]")?.focus();
  });
}
