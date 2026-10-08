import { z } from "zod";

export const dateHintSchema = z
  .object({
    kind: z.enum(["absolute", "month_day", "relative"]),
    value: z.string().trim().min(1).max(32),
    sourceText: z.string().trim().min(1).max(80),
  })
  .nullable()
  .optional()
  .catch(null);

export type DateHint = z.infer<typeof dateHintSchema>;

export interface DateOrganizationSuggestionItem {
  ledgerEntryId: string;
  dateHint: Exclude<DateHint, null | undefined>;
  resolvedDate: string | null;
  sourceText: string;
  snapshot: { itemName: string; amount: string; currency: string };
}

export interface DateOrganizationSuggestion {
  schemaVersion: 1;
  id: string;
  referenceDate: string | null;
  sourceDocumentDate: string;
  items: DateOrganizationSuggestionItem[];
}

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
