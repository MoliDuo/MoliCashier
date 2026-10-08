import "server-only";
import type { LedgerRefreshRequest, LedgerRefreshResult } from "../contract-refresh";
import { summarizeLedgerChanges } from "./ledger-changes";

const MAX_BIGINT_VERSION = BigInt("9223372036854775807");

function parseVersion(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export async function getStreamRefresh(
  request: LedgerRefreshRequest
): Promise<LedgerRefreshResult> {
  const parsedVersion = parseVersion(request.afterVersion);
  const requestVersionIsInvalid =
    parsedVersion == null || parsedVersion < BigInt(0) || parsedVersion > MAX_BIGINT_VERSION;
  const afterVersion = requestVersionIsInvalid ? BigInt(0) : parsedVersion;
  const summary = await summarizeLedgerChanges();
  const base = {
    version: summary.currentVersion.toString(),
    hasTransitionalWork: summary.hasTransitionalWork,
  };

  // A version the server never handed out (malformed, or ahead of the ledger) is
  // treated as stale, so the reader reads everything again.
  const changed = requestVersionIsInvalid || afterVersion !== summary.currentVersion;
  return { ...base, changed };
}
