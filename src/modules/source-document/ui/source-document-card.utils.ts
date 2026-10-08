import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import Decimal from "decimal.js";

export function sortSourceDocumentEntries(entries: LedgerEntryDto[]): LedgerEntryDto[] {
  return [...entries].sort((a, b) => {
    const categoryOrder = (a.category?.sortOrder ?? 999999) - (b.category?.sortOrder ?? 999999);
    return categoryOrder !== 0 ? categoryOrder : new Decimal(b.amount).cmp(a.amount);
  });
}

function getEntryCurrency(entry: LedgerEntryDto, mainCurrency: string): string {
  return entry.currency != null && entry.currency !== "" ? entry.currency : mainCurrency;
}

/** Sums the entries in the ledger's main currency. */
export function calculateSourceDocumentCardTotal(
  entries: LedgerEntryDto[],
  mainCurrency: string
): string {
  const total = entries.reduce((sum, entry) => {
    if (entry.convertedAmount != null && entry.convertedAmount !== "") {
      return sum.plus(entry.convertedAmount);
    }

    return getEntryCurrency(entry, mainCurrency) === mainCurrency ? sum.plus(entry.amount) : sum;
  }, new Decimal(0));

  return total.toFixed();
}
