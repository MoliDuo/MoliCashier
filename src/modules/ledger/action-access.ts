import "server-only";
import { redirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/modules/auth/constants";
import { UnauthorizedError } from "@/lib/errors";
import { withLedgerAccess } from "./access";

/**
 * A server action that meets a signed-out session sends the browser to sign in
 * instead of failing: in production Next replaces a thrown action error with a
 * generic one, so the page could only say "save failed" to someone whose
 * session simply ran out. Only actions use this — the `/api/ledger-queries`
 * route keeps the thrown `UnauthorizedError`, which it answers with a 401.
 *
 * It wraps the whole action, outside any try/catch the action keeps for its own
 * result codes, so nothing in between can swallow the redirect. A mutation
 * that is redirected may never settle; callers do not clean up in `onSettled`.
 */
export function redirectSignedOut<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    try {
      return await action(...args);
    } catch (error) {
      if (error instanceof UnauthorizedError) redirect(SIGN_IN_PATH);
      throw error;
    }
  };
}

/** Run a ledger command for a signed-in session; a signed-out one goes to sign in. */
export function withLedgerAction<TArgs extends unknown[], TReturn>(
  action: (...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return redirectSignedOut(withLedgerAccess(action));
}
