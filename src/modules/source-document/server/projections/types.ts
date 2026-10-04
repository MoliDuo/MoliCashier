import type { ProcessingLeaseContract } from "@/server/processing/types";
import type { DateHint, DateOrganizationSuggestion } from "@/lib/ai/date-organization";
import type { DuplicateSuggestion } from "@/lib/ai/duplicate-suggestion";

export interface LedgerProjectionEntryContract {
  id?: string;
  categoryId: string | null;
  amount: string;
  currency: string | null;
  itemName: string;
  description: string | null;
  createdAt?: string;
  dateHint?: DateHint;
  /** True for an entry the AI wrote; set when an attempt is activated. */
  extracted?: boolean;
}

export interface ActivateAttemptInput {
  sourceDocumentId: string;
  attemptId: string;
  title?: string | null;
  entries: readonly LedgerProjectionEntryContract[];
  dateOrganizationSuggestion?: DateOrganizationSuggestion | null;
  duplicateSuggestion?: DuplicateSuggestion | null;
  lease: ProcessingLeaseContract;
}
