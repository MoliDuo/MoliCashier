import type { DuplicateSuggestion, DuplicateSuggestionItem } from "@/lib/ai/duplicate-suggestion";

/** Where a handle given to the parse points; the model never sees the ids. */
export interface RecentEntryTarget {
  ledgerEntryId: string;
  sourceDocumentId: string;
}

/**
 * Turns the handles the parse flagged into a suggestion. A handle the parse
 * was never given is ignored, and one recorded entry can account for only one
 * new entry, so two new rows never both claim it.
 */
export function createDuplicateSuggestion(input: {
  entries: ReadonlyArray<{
    id: string;
    itemName: string;
    amount: string;
    currency: string;
    alreadyRecorded?: string;
  }>;
  targets: ReadonlyMap<string, RecentEntryTarget>;
}): DuplicateSuggestion | null {
  const claimed = new Set<string>();
  const items: DuplicateSuggestionItem[] = [];
  for (const entry of input.entries) {
    if (entry.alreadyRecorded == null) continue;
    const target = input.targets.get(entry.alreadyRecorded);
    if (target == null || claimed.has(target.ledgerEntryId)) continue;
    claimed.add(target.ledgerEntryId);
    items.push({
      ledgerEntryId: entry.id,
      snapshot: { itemName: entry.itemName, amount: entry.amount, currency: entry.currency },
      matched: {
        ledgerEntryId: target.ledgerEntryId,
        sourceDocumentId: target.sourceDocumentId,
      },
    });
  }
  return items.length === 0 ? null : { schemaVersion: 1, id: crypto.randomUUID(), items };
}
