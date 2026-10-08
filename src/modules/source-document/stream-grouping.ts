import type { SourceDocumentListItemDto } from "./contracts";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import { add } from "@/lib/money/decimal";

/**
 * Stream grouping — pure presentation model that groups consecutive server-ordered
 * items into date-based headers with per-group totals.
 *
 * This module intentionally keeps no React, query, or mutation dependencies.
 * No filtering, deduplication, or sorting is performed — items arrive in canonical
 * server order and are grouped consecutively by document date.
 */

interface UnifiedStreamItem {
  sourceDocument: SourceDocumentListItemDto;
  ledgerEntries: LedgerEntryEmbeddedViewDto[];
  /** The day the record counts on, as the server keeps it (yyyy-MM-dd). */
  documentDate: string;
}

export interface UnifiedStreamGroup {
  /** Document date key shared by items in this group. */
  date: string;
  /** Sum of active ledger-entry amounts across accounting-valid items in this group. */
  total: string;
  unconvertedCount: number;
  currencyTotals: Record<string, string>;
  items: UnifiedStreamItem[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function addEntries(
  group: UnifiedStreamGroup,
  entries: LedgerEntryEmbeddedViewDto[],
  mainCurrency?: string
): void {
  for (const entry of entries) {
    if (entry.convertedAmount != null && entry.convertedAmount !== "") {
      group.total = add(group.total, entry.convertedAmount);
      continue;
    }
    const currency = (entry.currency ?? mainCurrency)?.trim().toUpperCase();
    if (mainCurrency != null && currency === mainCurrency.trim().toUpperCase()) {
      group.total = add(group.total, entry.amount);
      continue;
    }
    group.unconvertedCount += 1;
    if (currency != null && currency !== "") {
      group.currencyTotals[currency] = add(group.currencyTotals[currency] ?? "0", entry.amount);
    }
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build stream groups from canonical server-ordered items.
 * Groups consecutive items by document date without re-sorting.
 */
export function buildUnifiedStreamGroups(
  items: readonly SourceDocumentListItemDto[],
  mainCurrency?: string
): UnifiedStreamGroup[] {
  const groups: UnifiedStreamGroup[] = [];
  for (const sourceDocument of items) {
    const entries = sourceDocument.ledgerEntries ?? [];
    const item: UnifiedStreamItem = {
      sourceDocument,
      ledgerEntries: entries,
      documentDate: sourceDocument.documentDate,
    };
    const lastGroup = groups.at(-1);
    let group: UnifiedStreamGroup;
    if (lastGroup != null && lastGroup.date === item.documentDate) {
      lastGroup.items.push(item);
      group = lastGroup;
    } else {
      group = {
        date: item.documentDate,
        total: "0",
        unconvertedCount: 0,
        currencyTotals: {},
        items: [item],
      };
      groups.push(group);
    }
    if (entries.length > 0) {
      addEntries(group, entries, mainCurrency);
    }
  }

  return groups;
}
