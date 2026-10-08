import { compare } from "@/lib/money/decimal";
import { normalizeSearchTerm } from "@/lib/search";
import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";

/** The entry filters a stream card's rows are narrowed by, as the stream SQL applies them. */
interface StreamFilterPolicy {
  minAmount?: string | null;
  maxAmount?: string | null;
  search?: string | null;
  /** A category id, or the uncategorized sentinel. */
  categoryId?: string | null;
  currency?: string | null;
}

/**
 * The stream read's form of a category filter: the uncategorized sentinel is
 * an answer of "no category", not the id of one.
 */
export function streamCategoryFilter(
  categoryId: string | null | undefined
): { categoryId: string } | { uncategorizedOnly: true } | Record<string, never> {
  if (categoryId == null || categoryId === "") return {};
  return categoryId === UNCATEGORIZED_SENTINEL ? { uncategorizedOnly: true } : { categoryId };
}

function normalizedSearch(search: StreamFilterPolicy["search"]): string | undefined {
  return normalizeSearchTerm(search);
}

function hasStreamEntryFilters(filters: StreamFilterPolicy): boolean {
  return (
    filters.minAmount != null ||
    filters.maxAmount != null ||
    normalizedSearch(filters.search) !== undefined ||
    (filters.categoryId != null && filters.categoryId !== "") ||
    (filters.currency != null && filters.currency !== "")
  );
}

/**
 * SQL baseConditions() applies every entry predicate to one EXISTS subquery.
 * Keep the same all-predicates-on-one-entry semantics for the card's rows.
 */
function matchesStreamEntry(
  entry: NonNullable<SourceDocumentListItemDto["ledgerEntries"]>[number],
  filters: StreamFilterPolicy
): boolean {
  if (filters.categoryId != null && filters.categoryId !== "") {
    const wanted = filters.categoryId === UNCATEGORIZED_SENTINEL ? null : filters.categoryId;
    if (entry.categoryId !== wanted) return false;
  }
  if (filters.currency != null && filters.currency !== "" && entry.currency !== filters.currency) {
    return false;
  }
  if (filters.minAmount != null || filters.maxAmount != null) {
    // The stream SQL only matches main-currency converted amounts; entries
    // without a conversion must never be treated as 1:1 matches.
    const amount = entry.convertedAmount;
    if (amount == null || amount === "") return false;
    try {
      if (filters.minAmount != null && compare(amount, String(filters.minAmount)) < 0) {
        return false;
      }
      if (filters.maxAmount != null && compare(amount, String(filters.maxAmount)) > 0) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const search = normalizedSearch(filters.search)?.toLocaleLowerCase();
  if (search == null) return true;
  return (
    entry.itemName.toLocaleLowerCase().includes(search) ||
    (entry.description?.toLocaleLowerCase().includes(search) ?? false)
  );
}

export function filterStreamEntries(
  entries: SourceDocumentListItemDto["ledgerEntries"] | undefined,
  filters: StreamFilterPolicy
): NonNullable<SourceDocumentListItemDto["ledgerEntries"]> {
  const resolvedEntries = entries ?? [];
  if (!hasStreamEntryFilters(filters)) return resolvedEntries;
  return resolvedEntries.filter((entry) => matchesStreamEntry(entry, filters));
}
