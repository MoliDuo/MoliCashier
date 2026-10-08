"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QUERY } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import type { LedgerDto, LedgerEntryPageDto } from "@/modules/ledger/contracts";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import type { Period } from "@/modules/ledger/domain/period";
import { fetchLedgerEntries, fetchLedgerSummary } from "@/modules/ledger/queries";
import { fetchEnhancedStats } from "@/modules/stats/queries";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";
import { buildStatsQueryDescriptor } from "./ledger-tab-query-descriptors";

function mainCurrencyOf(queryClient: QueryClient): string {
  return queryClient.getQueryData<LedgerDto>(queryKeys.ledger())?.settings.mainCurrency ?? "CNY";
}

/**
 * 明细's first page, fetched ahead of a tap. The keys name the period rather
 * than its days, so a prefetch lands on exactly the query the tab mounts.
 */
export async function prefetchDetailsTabQuery(
  queryClient: QueryClient,
  bookId: string | undefined,
  period: Period,
  advancedFilters: LedgerAdvancedFilters
) {
  const descriptor = buildDetailsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    period,
    advancedFilters,
    mainCurrency: mainCurrencyOf(queryClient),
  });

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: descriptor.summaryQueryKey,
      queryFn: ({ signal }) => fetchLedgerSummary(descriptor.summaryInput, { signal }),
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
    queryClient.prefetchInfiniteQuery({
      queryKey: descriptor.entriesQueryKey,
      queryFn: ({ pageParam, signal }) =>
        fetchLedgerEntries(descriptor.getEntriesInput(pageParam), { signal }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage: LedgerEntryPageDto) => lastPage.nextCursor,
      staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    }),
  ]);
}

export async function prefetchStatsTabQuery(
  queryClient: QueryClient,
  bookId: string | undefined,
  period: Period
) {
  const descriptor = buildStatsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    period,
    mainCurrency: mainCurrencyOf(queryClient),
  });

  await queryClient.prefetchQuery({
    queryKey: descriptor.queryKey,
    queryFn: ({ signal }) => fetchEnhancedStats(descriptor.input, { signal }),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
}
