"use client";
import {
  writeLedgerHistory,
  type LedgerNavigationKind,
} from "@/modules/ledger/navigation/ledger-history";
import {
  LEDGER_DETAIL_PARAM,
  readLedgerDetailParam,
} from "@/modules/ledger/navigation/ledger-detail-navigation";
import {
  LEDGER_NEW_RECORD_PARAM,
  readNewRecordParam,
} from "@/modules/ledger/navigation/ledger-new-record-navigation";
import { buildLedgerUrl } from "./ledger-url-params";

type SearchParamsLike = Pick<URLSearchParams, "toString">;

/**
 * Writes a change inside the current route — a filter, a stats period — as a
 * history entry of its own, without a server round trip. Leaving an open
 * detail or 记账 replaces its entry, so Back cannot reopen what just closed.
 */
export function pushLedgerUrl(
  pathname: string,
  searchParams: SearchParamsLike | URLSearchParams,
  kind: LedgerNavigationKind
): string {
  const current = new URLSearchParams(window.location.search);
  const leavingDetail = kind !== "detail" && readLedgerDetailParam(current) != null;
  const leavingOverlay = leavingDetail || readNewRecordParam(current);
  const nextSearchParams = new URLSearchParams(searchParams.toString());
  if (kind !== "detail") nextSearchParams.delete(LEDGER_DETAIL_PARAM);
  nextSearchParams.delete(LEDGER_NEW_RECORD_PARAM);
  const url = buildLedgerUrl(pathname, nextSearchParams);
  writeLedgerHistory(leavingOverlay ? "replace" : "push", url, kind);
  return url;
}

export function replaceLedgerUrl(
  pathname: string,
  searchParams: SearchParamsLike | URLSearchParams
): string {
  const url = buildLedgerUrl(pathname, searchParams);
  writeLedgerHistory("replace", url, "filter");
  return url;
}
