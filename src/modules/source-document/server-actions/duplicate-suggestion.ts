"use server";

import {
  applyDuplicateSuggestion,
  dismissDuplicateSuggestion,
} from "../server/duplicate-suggestion";
import {
  applyDuplicateSuggestionInputSchema,
  dismissDuplicateSuggestionInputSchema,
} from "@/modules/source-document/contract-schemas";
import { withLedgerAction } from "@/modules/ledger/action-access";

export const applyDuplicateSuggestionAction = withLedgerAction(async (input: unknown) => {
  const validated = applyDuplicateSuggestionInputSchema.parse(input);
  return applyDuplicateSuggestion(validated);
});

export const dismissDuplicateSuggestionAction = withLedgerAction(async (input: unknown) => {
  const validated = dismissDuplicateSuggestionInputSchema.parse(input);
  return dismissDuplicateSuggestion(validated);
});
