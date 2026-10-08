import { AppError } from "@/lib/errors";

const LEDGER_QUERY_TIMEOUT_MS = 15_000;

/** What a read may be handed by React Query: the signal that cancels it. */
export interface LedgerQueryOptions {
  signal?: AbortSignal | undefined;
}

/**
 * The read's own deadline, joined with the caller's signal so a query React
 * Query cancels (a page left, a key replaced) stops its request too. Browsers
 * without `AbortSignal.any` keep only the deadline.
 */
function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(LEDGER_QUERY_TIMEOUT_MS);
  if (signal == null || typeof AbortSignal.any !== "function") return timeout;
  return AbortSignal.any([signal, timeout]);
}

/**
 * The browser side of `/api/ledger-queries`: one POST per read, with the
 * status kept on failure so auth and retry decisions can read it. Each module's
 * `queries.ts` wraps it with the input and result types of its own reads.
 */
export async function postLedgerQuery<T>(
  query: string,
  args: readonly unknown[] = [],
  { signal }: LedgerQueryOptions = {}
): Promise<T> {
  const response = await fetch("/api/ledger-queries", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, args }),
    signal: requestSignal(signal),
  });
  if (!response.ok) {
    throw new AppError("Ledger query failed", "LEDGER_QUERY_FAILED", response.status);
  }
  return response.json() as Promise<T>;
}
