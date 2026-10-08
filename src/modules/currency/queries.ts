import { postLedgerQuery, type LedgerQueryOptions } from "@/lib/queries/post-ledger-query";
import type { ConvertCurrencyResult } from "./contracts";

/** A conversion at the rate of `date` (or the latest), served by `/api/ledger-queries`. */
export const fetchConvertedAmount = (
  input: {
    amount: string;
    from: string;
    to: string;
    date?: string;
  },
  options?: LedgerQueryOptions
) => postLedgerQuery<ConvertCurrencyResult>("convert-currency", [input], options);
