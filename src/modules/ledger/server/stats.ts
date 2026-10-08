import { parseLedgerStatsQuery } from "@/modules/ledger/contract-schemas";
import type { LedgerSummaryDto } from "@/modules/ledger/contracts";
import { toLedgerEntryFilters } from "../domain/to-ledger-entry-filters";
import { calculateLedgerEntryStats } from "./entry-reads/calculate-ledger-entry-stats";

/**
 * The ledger's totals for one filtered window. It validates here rather than in
 * the transport above it, so the session route and the server-side prefetch
 * cannot disagree about what a query means.
 */
export async function calculateLedgerStats(query: unknown): Promise<LedgerSummaryDto> {
  const validated = parseLedgerStatsQuery(query);
  return calculateLedgerEntryStats({ filters: toLedgerEntryFilters(validated) });
}
