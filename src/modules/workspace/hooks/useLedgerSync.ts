"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { invalidateVisibleLedger } from "@/lib/mutations/ledger-sync";
import { fetchStreamRefresh } from "@/modules/source-document/queries";
import type { LedgerRefreshResult } from "@/modules/source-document/contract-refresh";

const REFRESH_INTERVAL_MS = 3_000;
/**
 * With nothing processing, a visible page still asks now and then, so what the
 * other person records turns up without leaving the page. One version compare
 * per half minute is cheap next to what it saves.
 */
const IDLE_REFRESH_INTERVAL_MS = 30_000;
const REFRESH_STALE_TIME_MS = 3_000;
const MAX_ERROR_INTERVAL_MS = 30_000;
const consecutiveFailures = new WeakMap<object, number>();

/**
 * The ledger's one refresh driver, mounted once by the ledger layout so every
 * route is kept current by the same poll. It reads the ledger's sync version;
 * when the version has moved, every visible ledger query reads again —
 * whichever of them the change touched. While records are still being
 * processed the visible page polls every few seconds, otherwise every half
 * minute; a hidden page does not poll, and refreshes when the window regains
 * focus or the network comes back.
 */
export function useLedgerSync() {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.ledgerSync();

  return useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<LedgerRefreshResult> => {
      try {
        const previous = queryClient.getQueryData<LedgerRefreshResult>(queryKey);
        const result = await fetchStreamRefresh(
          { afterVersion: previous?.version ?? "0" },
          { signal }
        );
        // A page that fails to read shows its own error. The driver keeps the new
        // version either way: failing here would leave the old one and invalidate
        // every visible query again on each poll.
        if (previous != null && result.changed) {
          await invalidateVisibleLedger(queryClient).catch(() => undefined);
        }
        consecutiveFailures.delete(queryClient);
        return result;
      } catch (error) {
        consecutiveFailures.set(queryClient, (consecutiveFailures.get(queryClient) ?? 0) + 1);
        throw error;
      }
    },
    staleTime: REFRESH_STALE_TIME_MS,
    retry: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") {
        const failureCount = Math.max(
          query.state.fetchFailureCount,
          consecutiveFailures.get(queryClient) ?? 0
        );
        return Math.min(
          REFRESH_INTERVAL_MS * 2 ** Math.max(failureCount - 1, 0),
          MAX_ERROR_INTERVAL_MS
        );
      }
      return query.state.data?.hasTransitionalWork === true
        ? REFRESH_INTERVAL_MS
        : IDLE_REFRESH_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}
