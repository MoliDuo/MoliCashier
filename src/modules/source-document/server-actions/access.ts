import { requireLedgerAccess } from "@/modules/ledger/access";
import { redirectSignedOut } from "@/modules/ledger/action-access";

type SourceDocumentLedgerActionContext = Awaited<ReturnType<typeof requireLedgerAccess>>;

/**
 * Run a source-document command that needs the signed-in account or the ledger's settings.
 * A signed-out session goes to sign in, as for every other action.
 */
export function withSourceDocumentLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (context: SourceDocumentLedgerActionContext, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return redirectSignedOut(async (...args: TArgs) => action(await requireLedgerAccess(), ...args));
}
