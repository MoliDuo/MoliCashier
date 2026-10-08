import { postLedgerQuery, type LedgerQueryOptions } from "@/lib/queries/post-ledger-query";
import type { Period } from "@/modules/ledger/domain/period";
import type { EnhancedStatsDto } from "./contracts";

/** The 统计 read, served by `/api/ledger-queries`: a period the server resolves. */
export const fetchEnhancedStats = (
  input: { bookId?: string; period: Period },
  options?: LedgerQueryOptions
) => postLedgerQuery<EnhancedStatsDto>("stats", [input], options);
