"use client";

import { writeLedgerHistory } from "@/modules/ledger/navigation/ledger-history";
import { leavePastOverlays } from "@/lib/navigation/overlay-history";

/** The open 记账 sheet, as `?new=1` on whichever ledger route it was opened from. */
export const LEDGER_NEW_RECORD_PARAM = "new";

export function readNewRecordParam(params: Pick<URLSearchParams, "get">): boolean {
  return params.get(LEDGER_NEW_RECORD_PARAM) === "1";
}

function newRecordUrl(open: boolean): string {
  const params = new URLSearchParams(window.location.search);
  if (open) params.set(LEDGER_NEW_RECORD_PARAM, "1");
  else params.delete(LEDGER_NEW_RECORD_PARAM);
  const query = params.toString();
  return query === "" ? window.location.pathname : `${window.location.pathname}?${query}`;
}

function newRecordWasPushed(): boolean {
  const state = window.history.state as { cashier?: { kind?: string } } | null;
  return state?.cashier?.kind === "new-record";
}

/**
 * Opens 记账 as a history entry of its own, the way a record's sheet opens,
 * so the system back gesture closes the sheet instead of leaving the page
 * underneath it.
 */
export function openNewRecord(): void {
  if (readNewRecordParam(new URLSearchParams(window.location.search))) return;
  writeLedgerHistory("push", newRecordUrl(true), "new-record");
}

/**
 * Closes 记账 the way Back would: an entry the sheet pushed is popped, and
 * one reached by a link or a reload has its parameter replaced away.
 */
export function closeNewRecord(): void {
  if (!readNewRecordParam(new URLSearchParams(window.location.search))) return;
  const replaceAway = () => writeLedgerHistory("replace", newRecordUrl(false), "filter");
  if (newRecordWasPushed()) {
    // A dialog still open inside it (the image viewer) leaves with it.
    if (!leavePastOverlays(1)) window.history.back();
    return;
  }
  if (!leavePastOverlays(0, replaceAway)) replaceAway();
}
