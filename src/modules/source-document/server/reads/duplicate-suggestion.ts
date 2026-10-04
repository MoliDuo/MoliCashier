import { inArray, eq } from "drizzle-orm";
import type { DuplicateSuggestion } from "@/lib/ai/duplicate-suggestion";
import type { DuplicateSuggestionDto } from "@/modules/source-document/document-contracts";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { ledgerEntries, sourceDocuments } from "@/persistence";

/**
 * The suggestion as the reader sees it: each flagged entry beside the entry it
 * repeats. An item whose entry or counterpart is gone is left out, so deleting
 * the other record withdraws the suggestion without a write.
 */
export async function resolveDuplicateSuggestion(
  tx: PostgresTransaction,
  suggestion: DuplicateSuggestion | null,
  currentEntries: ReadonlyArray<{
    id: string;
    itemName: string;
    amount: string;
    currency: string;
  }>
): Promise<DuplicateSuggestionDto | null> {
  if (suggestion == null || suggestion.items.length === 0) return null;
  const matchedRows = await tx
    .select({
      id: ledgerEntries.id,
      itemName: ledgerEntries.itemName,
      sourceDocumentId: sourceDocuments.id,
      title: sourceDocuments.title,
      documentDate: sourceDocuments.documentDate,
    })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(
      inArray(
        ledgerEntries.id,
        suggestion.items.map((item) => item.matched.ledgerEntryId)
      )
    );
  const matchedById = new Map(matchedRows.map((row) => [row.id, row]));
  const entriesById = new Map(currentEntries.map((entry) => [entry.id, entry]));
  const items = suggestion.items.flatMap((item) => {
    const entry = entriesById.get(item.ledgerEntryId);
    const matched = matchedById.get(item.matched.ledgerEntryId);
    if (entry == null || matched == null) return [];
    return [
      {
        ledgerEntryId: entry.id,
        itemName: entry.itemName,
        amount: entry.amount,
        currency: entry.currency,
        matched: {
          sourceDocumentId: matched.sourceDocumentId,
          title: matched.title?.trim() || null,
          documentDate: matched.documentDate,
          itemName: matched.itemName,
        },
      },
    ];
  });
  if (items.length === 0) return null;
  return {
    id: suggestion.id,
    items,
    coversWholeDocument: items.length === currentEntries.length,
  };
}
