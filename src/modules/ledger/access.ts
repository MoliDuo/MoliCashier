import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getLedger } from "./server/live-ledger";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import type { LedgerDto } from "./contracts";

/** The ledger, or NotFoundError before it is created. The caller has settled the session. */
export async function requireLedger(): Promise<LedgerDto> {
  const ledger = await getLedger();
  if (ledger == null) throw new NotFoundError("Ledger");
  return ledger;
}

/**
 * Resolve the session and the ledger. The browser never names a ledger: there
 * is only one, so a signed-in session reaches it.
 */
export async function requireLedgerAccess() {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError();
  return { ledger: await requireLedger() };
}

/** Run a ledger command for a signed-in session. */
export function withLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    await requireLedgerAccess();
    return action(...args);
  };
}
