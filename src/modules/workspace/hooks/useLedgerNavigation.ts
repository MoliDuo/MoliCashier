"use client";
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LEDGER_PERIOD_TABS,
  ledgerTabFromPathname,
  ledgerTabHref,
  type LedgerTab,
} from "@/modules/workspace/ledger-tabs";
import { readLedgerDetailParam } from "@/modules/ledger/navigation/ledger-detail-navigation";
import { readNewRecordParam } from "@/modules/ledger/navigation/ledger-new-record-navigation";
import { isOverlayHistoryEntry } from "@/lib/navigation/overlay-history";
import { useWorkspaceStore } from "../store";
import { readPeriodParams, writePeriodParams } from "../period-url-params";

/**
 * Moves between the ledger's routes. A tab opens on the query it was last left
 * with, so 账目's filters are still there after a look at 统计 — but the period
 * is one for the whole ledger, so it comes along from the route being left, or
 * through 设置 from the last route that showed one.
 * Scroll position is each tab's own business (useTabScrollRestoration).
 */
export function useLedgerNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeQueries = useWorkspaceStore((state) => state.routeQueries);
  const lastPeriodTab = useWorkspaceStore((state) => state.lastPeriodTab);
  const activeTab = ledgerTabFromPathname(pathname);

  const hrefFor = useCallback(
    (tab: LedgerTab) => {
      const remembered = new URLSearchParams(routeQueries[tab] ?? "");
      const periodSource = LEDGER_PERIOD_TABS.has(activeTab)
        ? searchParams
        : lastPeriodTab != null && lastPeriodTab !== tab
          ? new URLSearchParams(routeQueries[lastPeriodTab] ?? "")
          : null;
      const query =
        LEDGER_PERIOD_TABS.has(tab) && periodSource != null
          ? writePeriodParams(remembered, readPeriodParams(periodSource))
          : remembered;
      return ledgerTabHref(tab, query.toString());
    },
    [activeTab, lastPeriodTab, routeQueries, searchParams]
  );

  const navigate = useCallback(
    (tab: LedgerTab, query?: URLSearchParams) => {
      const href = query == null ? hrefFor(tab) : ledgerTabHref(tab, query.toString());
      // An open detail's or 记账's history entry is replaced, so Back cannot
      // reopen it.
      const current = new URLSearchParams(window.location.search);
      if (
        readLedgerDetailParam(current) != null ||
        readNewRecordParam(current) ||
        isOverlayHistoryEntry()
      ) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    },
    [hrefFor, router]
  );

  return { activeTab, hrefFor, navigate, prefetch: router.prefetch };
}
