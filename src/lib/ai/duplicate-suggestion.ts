/**
 * A parse that found rows the ledger already holds. It is only a suggestion:
 * the new entries stay in place until the owner confirms removing them.
 */
export interface DuplicateSuggestionItem {
  ledgerEntryId: string;
  snapshot: { itemName: string; amount: string; currency: string };
  matched: { ledgerEntryId: string; sourceDocumentId: string };
}

export interface DuplicateSuggestion {
  schemaVersion: 1;
  id: string;
  items: DuplicateSuggestionItem[];
}
