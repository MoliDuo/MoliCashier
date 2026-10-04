import { compare } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import type { CategoryInfo, ParsedLedgerEntry } from "@/lib/ai/types";

export interface EntryToInsert {
  id: string;
  categoryId: string | null;
  sourceDocumentId: string;
  amount: string;
  currency: string;
  itemName: string;
  description: string | null;
  entryDate: string;
  dateHint?: import("@/lib/ai/date-organization").DateHint;
  alreadyRecorded?: string;
}

export interface BuildEntriesParams {
  validEntries: ParsedLedgerEntry[];
  categories: CategoryInfo[];
  sourceDocumentId: string;
  fallbackDate: string;
}

/**
 * Build entries for database insertion. Amounts stay in their own currency;
 * reads convert them at the document's day's rate.
 */
export function buildEntriesForInsert({
  validEntries,
  categories,
  sourceDocumentId,
  fallbackDate,
}: BuildEntriesParams): EntryToInsert[] {
  return validEntries.map((entry) => {
    // categoryIndex is 1-based: 0 = no category, 1 = categories[0], 2 = categories[1], ...
    const categoryId =
      entry.categoryIndex > 0 && entry.categoryIndex <= categories.length
        ? (categories[entry.categoryIndex - 1]?.id ?? null)
        : null;

    const entryCurrency = entry.currency ?? "CNY";

    return {
      id: crypto.randomUUID(),
      categoryId,
      sourceDocumentId,
      amount: roundToCurrency(String(entry.amount), entryCurrency),
      currency: entryCurrency,
      itemName: entry.itemName !== "" ? entry.itemName : "Uncategorized",
      description: entry.notes ?? null,
      entryDate: fallbackDate,
      ...(entry.dateHint == null ? {} : { dateHint: entry.dateHint }),
      ...(entry.alreadyRecorded == null ? {} : { alreadyRecorded: entry.alreadyRecorded }),
    };
  });
}

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Validate entries before saving
 */
export function validateEntries(entries: ParsedLedgerEntry[]): ValidationResult {
  if (
    entries.some(
      (entry) =>
        compare(roundToCurrency(entry.amount, entry.currency ?? "CNY"), "0") === 0 ||
        (compare(entry.amount, "0") < 0 && entry.isAdjustment !== true)
    )
  ) {
    return { isValid: false, reason: "Invalid expense amount" };
  }
  // Adjustments (discounts, fees) may have negative amounts — keep them
  const positiveEntries = entries.filter(
    (entry) => compare(entry.amount, "0") > 0 || entry.isAdjustment === true
  );

  if (positiveEntries.length === 0) {
    return { isValid: false, reason: "No entries with valid amount" };
  }

  const unknownCurrencyEntries = positiveEntries.filter(
    (entry) =>
      entry.currency == null || entry.currency === "" || entry.currency.toLowerCase() === "unknown"
  );

  if (unknownCurrencyEntries.length > 0) {
    return { isValid: false, reason: "Unable to recognize currency type" };
  }

  return { isValid: true };
}

export interface DateFallbackResult {
  todayDate: string;
  fallbackDate: string;
}

/**
 * The day entries fall back to: the record's own, or today in the ledger's
 * zone, which the caller names so this stays free of any clock or zone.
 */
export function getEntryFallbackDate(
  docEntryDate: string | null,
  todayDate: string
): DateFallbackResult {
  const fallbackDate = docEntryDate ?? todayDate;

  return { todayDate, fallbackDate };
}
