import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SyncVersion {
  version: string;
}

/** The latest invalidation the refresh driver started, per client, for a write to wait on. */
const latestInvalidation = new WeakMap<QueryClient, Promise<void>>();

/**
 * Every ledger query on screen reads again; the ones not mounted wait until they
 * are. The promise rejects when any of them fails to read.
 */
export function invalidateVisibleLedger(queryClient: QueryClient): Promise<void> {
  const invalidation = queryClient.invalidateQueries(
    { queryKey: queryKeys.ledger(), refetchType: "active" },
    { throwOnError: true }
  );
  latestInvalidation.set(queryClient, invalidation);
  // A caller that does not wait on it must not leave an unhandled rejection.
  invalidation.catch(() => undefined);
  return invalidation;
}

/**
 * After a write, the ledger catches up the way it does for any change: the
 * sync version is read again, and a version that moved invalidates every
 * visible ledger query from inside that read. A write the version does not
 * track — a key, a book — leaves it where it was, so the queries are
 * invalidated here instead. Either way each query reads once.
 */
export async function syncLedgerAfterWrite(queryClient: QueryClient): Promise<void> {
  const syncKey = queryKeys.ledgerSync();
  const before = queryClient.getQueryData<SyncVersion>(syncKey)?.version;
  const observed =
    queryClient.getQueryCache().find({ queryKey: syncKey, exact: true, type: "active" }) != null;
  if (observed) {
    const previousInvalidation = latestInvalidation.get(queryClient);
    await queryClient.refetchQueries(
      { queryKey: syncKey, exact: true, type: "active" },
      { throwOnError: true }
    );
    const after = queryClient.getQueryData<SyncVersion>(syncKey)?.version;
    if (after != null && after !== before) {
      // The refresh driver does not fail on a page's read (each page shows its
      // own error), but a write still says when what it changed did not load.
      const invalidation = latestInvalidation.get(queryClient);
      if (invalidation != null && invalidation !== previousInvalidation) await invalidation;
      return;
    }
  }
  await invalidateVisibleLedger(queryClient);
}
