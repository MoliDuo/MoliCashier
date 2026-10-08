"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { fetchEntryCategories, fetchLedger } from "@/modules/ledger/queries";
import { useWorkspaceStore } from "../store";

const STALE_TIME = LEDGER.STALE_TIME_MS;

/**
 * Owns the ledger and category queries every ledger page tab depends on, and
 * the workspace's ready flag. The ledger carries its own zone, so nothing here
 * waits on the device to name one.
 */
export function useLedgerPageEnvironment() {
  const ledgerQuery = useQuery({
    queryKey: queryKeys.ledger(),
    queryFn: ({ signal }) => fetchLedger({ signal }),
    staleTime: STALE_TIME,
  });
  const ledger = ledgerQuery.data;

  const categoriesQuery = useQuery({
    queryKey: queryKeys.entryCategories(),
    queryFn: ({ signal }) => fetchEntryCategories({ signal }),
    staleTime: STALE_TIME,
  });
  const categories = categoriesQuery.data ?? [];
  const categoriesHaveNoData = categoriesQuery.data === undefined;

  // The shell's navigation waits for the page to mount, so an early tap cannot
  // race hydration.
  const setReady = useWorkspaceStore((state) => state.setReady);
  useEffect(() => {
    setReady(true);
    return () => setReady(false);
  }, [setReady]);

  return {
    ledger,
    ledgerQuery,
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency: ledger?.settings.mainCurrency ?? "CNY",
    preferredCurrencies: ledger?.settings.currencies ?? [],
  };
}
