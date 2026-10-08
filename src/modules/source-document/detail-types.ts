/** The record's own fields the detail sheet writes, each on its own. */
export interface DocumentPatch {
  title?: string;
  documentDate?: string;
}

/** Fields collected by the "add entry" dialog for a new ledger entry. */
export interface AddEntryData {
  itemName: string;
  /** A plain decimal string; the server rounds it to the currency's decimals. */
  amount: string;
  currency?: string;
  categoryId?: string;
  description?: string | null;
}

export interface EntryEditData {
  itemName: string;
  amount: string;
  currency: string;
  categoryId: string | null;
  description: string | null;
}
