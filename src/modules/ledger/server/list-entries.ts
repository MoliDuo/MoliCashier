import { parseListLedgerEntriesInput } from "@/modules/ledger/contract-schemas";
import type { LedgerEntryPageDto } from "@/modules/ledger/contracts";
import { toLedgerEntryFilters } from "../domain/to-ledger-entry-filters";
import { listLedgerEntryPage } from "./entry-reads/list-ledger-entry-page";

/**
 * The ledger's entries, one page at a time. This is the single entry point for
 * the query — the session route and the server-side prefetch both reach it — so
 * it validates its own input.
 */
export async function listLedgerEntries(params: unknown): Promise<LedgerEntryPageDto> {
  const validated = parseListLedgerEntriesInput(params);
  return listLedgerEntryPage({
    limit: validated.limit,
    cursor: validated.cursor ?? null,
    filters: toLedgerEntryFilters(validated),
  });
}
