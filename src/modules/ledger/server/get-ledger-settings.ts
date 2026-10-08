import type { LedgerSettingsViewDto } from "@/modules/ledger/contracts";
import { countUncategorizedEntries } from "./categories";
import { listServiceCredentials } from "./service-credentials";

/**
 * Returns uncategorizedCount and credentials only. Categories are read
 * separately (the `categories` query) so optimistic category edits keep
 * sharing one cache entry with the category mutations.
 */
export async function getLedgerSettingsView(): Promise<LedgerSettingsViewDto> {
  const [uncategorizedCount, credentials] = await Promise.all([
    countUncategorizedEntries(),
    listServiceCredentials(),
  ]);
  return { uncategorizedCount, credentials };
}
