import Decimal from "decimal.js";
import { roundToCurrency } from "@/lib/money/currency-precision";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import type { EntryEditData } from "@/modules/source-document/types";

interface SourceDocumentDetailDisplayEntry extends Omit<
  LedgerEntryDto,
  "amount" | "convertedAmount" | "exchangeRate" | "currency"
> {
  amount: string;
  convertedAmount: string | null;
  exchangeRate: string | null;
  currency: string;
  conversionIdentityChanged: boolean;
}

interface BuildSourceDocumentDetailViewModelInput {
  ledgerEntries: LedgerEntryDto[];
  /** Entry values being written, keyed by entry id. */
  pendingChanges: { entries: Record<string, Partial<EntryEditData>> };
  mainCurrency: string;
  entryDate: string;
  originalEntryDate: string;
}

export function buildSourceDocumentDetailViewModel({
  ledgerEntries,
  pendingChanges,
  mainCurrency,
  entryDate,
  originalEntryDate,
}: BuildSourceDocumentDetailViewModelInput) {
  const displayEntries: SourceDocumentDetailDisplayEntry[] = ledgerEntries.map((entry) => {
    const change = pendingChanges.entries[entry.id] ?? {};
    const currency = change.currency ?? entry.currency ?? mainCurrency;
    const amount = new Decimal(change.amount ?? entry.amount).toFixed();
    // "Identity changed" means the currency or entry date that produced the
    // persisted convertedAmount no longer matches the value being written, so
    // that persisted value can't be reused. This is expected while a write is
    // in flight (it resolves once the entry is saved and recalculated) and
    // must not be reported as a missing exchange rate.
    const conversionIdentityChanged =
      currency !== (entry.currency ?? mainCurrency) || entryDate !== originalEntryDate;
    const exchangeRate =
      !conversionIdentityChanged && entry.exchangeRate != null && entry.exchangeRate !== ""
        ? entry.exchangeRate
        : null;

    const convertedAmount =
      currency === mainCurrency
        ? amount
        : entry.convertedAmount != null &&
            entry.convertedAmount !== "" &&
            change.amount === undefined &&
            change.currency === undefined &&
            entryDate === originalEntryDate
          ? new Decimal(entry.convertedAmount).toFixed()
          : exchangeRate != null
            ? roundToCurrency(new Decimal(amount).times(exchangeRate).toFixed(), mainCurrency)
            : null;

    return {
      ...entry,
      amount,
      currency,
      convertedAmount,
      exchangeRate,
      conversionIdentityChanged,
    };
  });

  const totalInMainCurrency = displayEntries
    .reduce((total, entry) => total.plus(entry.convertedAmount ?? 0), new Decimal(0))
    .toFixed();
  // A null convertedAmount has two distinct causes that must not be conflated:
  //  - the entry's conversion identity changed and hasn't been recomputed
  //    yet (staleConversionCount below) — expected while a write is in
  //    flight, resolves once it lands, and is NOT a missing exchange rate;
  //  - the identity is unchanged but no persisted/derivable rate exists
  //    (unconvertedCount) — this is the real "missing exchange rate" case.
  const unconvertedCount = displayEntries.filter(
    (entry) => !entry.conversionIdentityChanged && entry.convertedAmount == null
  ).length;
  const staleConversionCount = displayEntries.filter(
    (entry) => entry.conversionIdentityChanged && entry.currency !== mainCurrency
  ).length;

  return {
    displayEntries,
    totalInMainCurrency,
    unconvertedCount,
    staleConversionCount,
  };
}
