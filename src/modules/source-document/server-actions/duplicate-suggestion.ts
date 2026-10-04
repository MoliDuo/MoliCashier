"use server";

import {
  applyDuplicateSuggestion,
  dismissDuplicateSuggestion,
} from "../server/duplicate-suggestion";
import {
  applyDuplicateSuggestionInputSchema,
  dismissDuplicateSuggestionInputSchema,
} from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

export const applyDuplicateSuggestionAction = withLedgerAccess(async (input: unknown) => {
  const validated = applyDuplicateSuggestionInputSchema.parse(input);
  return applyDuplicateSuggestion(validated);
});

export const dismissDuplicateSuggestionAction = withLedgerAccess(async (input: unknown) => {
  const validated = dismissDuplicateSuggestionInputSchema.parse(input);
  return dismissDuplicateSuggestion(validated);
});
