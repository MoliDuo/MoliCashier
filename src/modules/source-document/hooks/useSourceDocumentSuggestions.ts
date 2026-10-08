"use client";

import type { QueryKey } from "@tanstack/react-query";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import type {
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
  ApplyDuplicateSuggestionResultDto,
  SourceDocumentDetailDto,
} from "@/modules/source-document/contracts";
import {
  applyDateOrganizationAction,
  dismissDateOrganizationAction,
} from "@/modules/source-document/server-actions/date-organization";
import {
  applyDuplicateSuggestionAction,
  dismissDuplicateSuggestionAction,
} from "@/modules/source-document/server-actions/duplicate-suggestion";

/**
 * The record's suggestions: organizing its entries by date, and removing the
 * rows the parse saw recorded already. Applying one answers with the committed
 * record, which goes straight into the detail cache.
 */
export function useSourceDocumentSuggestions({
  id,
  detailKey,
  commitDetailSnapshot,
  onClose,
}: {
  id: string;
  detailKey: QueryKey;
  commitDetailSnapshot: (document: SourceDocumentDetailDto) => Promise<void>;
  onClose: () => void;
}) {
  // The sheet reports these failures itself.
  const dateOrganizationMutation = useLedgerMutation<
    ApplyDateOrganizationResultDto,
    Omit<ApplyDateOrganizationInput, "sourceDocumentId">
  >({
    errorMessage: null,
    mutationFn: (input) => applyDateOrganizationAction({ sourceDocumentId: id, ...input }),
    waitFor: detailKey,
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const dismissDateOrganizationMutation = useLedgerMutation<{ dismissed: true }, string>({
    errorMessage: null,
    mutationFn: (suggestionId) =>
      dismissDateOrganizationAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
  });
  const applyDuplicateMutation = useLedgerMutation<ApplyDuplicateSuggestionResultDto, string>({
    errorMessage: null,
    mutationFn: (suggestionId) =>
      applyDuplicateSuggestionAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
    onSuccess: (result) => {
      // A record that held only repeats is gone, so there is nothing left to show.
      if (result.sourceDocument == null) onClose();
      else return commitDetailSnapshot(result.sourceDocument);
    },
  });
  const dismissDuplicateMutation = useLedgerMutation<{ dismissed: true }, string>({
    errorMessage: null,
    mutationFn: (suggestionId) =>
      dismissDuplicateSuggestionAction({ sourceDocumentId: id, suggestionId }),
    waitFor: detailKey,
  });

  return {
    applyDateOrganization: dateOrganizationMutation.mutateAsync,
    dismissDateOrganization: dismissDateOrganizationMutation.mutateAsync,
    isOrganizingDates:
      dateOrganizationMutation.isPending || dismissDateOrganizationMutation.isPending,
    applyDuplicateSuggestion: applyDuplicateMutation.mutateAsync,
    dismissDuplicateSuggestion: dismissDuplicateMutation.mutateAsync,
    isResolvingDuplicates: applyDuplicateMutation.isPending || dismissDuplicateMutation.isPending,
  };
}
