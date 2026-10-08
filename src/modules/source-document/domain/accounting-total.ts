import { add } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";

/**
 * Sums entries converted to the ledger's main currency. Null when an entry
 * has no rate for its day yet: a partial sum would read as the whole total.
 */
export function accountingTotal(
  entries: readonly { convertedAmount: string | null }[],
  mainCurrency: string
): string | null {
  let total = "0";
  for (const entry of entries) {
    if (entry.convertedAmount == null) return null;
    total = add(total, entry.convertedAmount);
  }
  return roundToCurrency(total, mainCurrency);
}
