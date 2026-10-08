"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textRoleClassName } from "@/components/typography";
import { fetchCategoryAssignmentResults } from "@/modules/ledger/queries";
import { queryKeys } from "@/lib/query-keys";
import type { CategoryAssignmentJob } from "@/modules/ledger/contracts";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy } from "@/copy/workspace";

interface CategoryAssignmentResultDialogProps {
  job: CategoryAssignmentJob;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRetryFailed?: () => void;
  onRetryLatest?: () => void;
}

export function CategoryAssignmentResultDialog({
  job,
  open,
  onOpenChange,
  onRetryFailed,
  onRetryLatest,
}: CategoryAssignmentResultDialogProps) {
  const outcomeLabel = (outcome: string | null) => {
    switch (outcome) {
      case "applied":
        return batchActionsCopy.categoryOutcomeApplied;
      case "confirmed":
        return batchActionsCopy.categoryOutcomeConfirmed;
      case "conflict":
        return batchActionsCopy.categoryOutcomeConflict;
      case "skipped":
        return batchActionsCopy.categoryOutcomeSkipped;
      case "cancelled":
        return batchActionsCopy.categoryOutcomeCancelled;
      default:
        return batchActionsCopy.categoryOutcomeFailed;
    }
  };
  const errorLabel = (errorCode: string) => {
    switch (errorCode) {
      case "ai_timeout":
        return batchActionsCopy.categoryErrorAiTimeout;
      case "ai_rate_limited":
        return batchActionsCopy.categoryErrorAiRateLimited;
      case "ai_provider_unavailable":
        return batchActionsCopy.categoryErrorAiUnavailable;
      case "ai_configuration_invalid":
        return batchActionsCopy.categoryErrorAiConfiguration;
      case "ai_schema_invalid":
        return batchActionsCopy.categoryErrorAiSchema;
      case "storage_unavailable":
        return batchActionsCopy.categoryErrorStorage;
      case "document_changed":
        return batchActionsCopy.categoryErrorDocumentChanged;
      case "document_unavailable":
        return batchActionsCopy.categoryErrorDocumentUnavailable;
      case "category_changed":
        return batchActionsCopy.categoryErrorCategoryChanged;
      case "selection_upload_expired":
        return batchActionsCopy.categoryErrorUploadExpired;
      case "upgrade_interrupted":
        return batchActionsCopy.categoryErrorUpgradeInterrupted;
      default:
        return batchActionsCopy.categoryErrorUnknown;
    }
  };
  const results = useInfiniteQuery({
    queryKey: queryKeys.categoryAssignmentResults(job.id),
    queryFn: ({ pageParam, signal }) =>
      fetchCategoryAssignmentResults(
        {
          jobId: job.id,
          ...(pageParam == null ? {} : { cursor: pageParam }),
          limit: 50,
        },
        { signal }
      ),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: open,
  });
  const items = results.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="detail"
        aria-describedby={undefined}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:rounded-lg"
      >
        <DialogHeader className="shrink-0 border-b px-12 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{batchActionsCopy.categoryResultsTitle}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {job.evidenceIncomplete ? (
            <p className={textRoleClassName("bodyMuted", "mb-3 text-warning")} role="status">
              {batchActionsCopy.categoryEvidenceIncomplete}
            </p>
          ) : null}
          {results.isError ? (
            <div className="space-y-3" role="alert">
              <p className={textRoleClassName("bodyMuted")}>
                {batchActionsCopy.categoryJobReadFailed}
              </p>
              <Button variant="outline" onClick={() => void results.refetch()}>
                {commonCopy.refresh}
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.ledgerEntryId} className="space-y-1 py-3">
                  <div className={textRoleClassName("bodyStrong")}>
                    {item.itemName ?? batchActionsCopy.categoryEntryDeleted}
                  </div>
                  <p className={textRoleClassName("meta")}>
                    {(item.originalCategoryName ?? batchActionsCopy.uncategorized) +
                      " -> " +
                      (item.targetCategoryName ?? batchActionsCopy.uncategorized)}
                  </p>
                  <p className={textRoleClassName("meta")}>
                    {outcomeLabel(item.outcome)}
                    {item.errorCode == null ? "" : `: ${errorLabel(item.errorCode)}`}
                  </p>
                </div>
              ))}
              {results.hasNextPage ? (
                <Button
                  className="mt-4 w-full"
                  variant="outline"
                  disabled={results.isFetchingNextPage}
                  onClick={() => void results.fetchNextPage()}
                >
                  {commonCopy.loadMore}
                </Button>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 gap-2 border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-4">
          {job.canRetryFailed && onRetryFailed != null ? (
            <Button variant="outline" onClick={onRetryFailed}>
              {batchActionsCopy.categoryRetryFailed}
            </Button>
          ) : null}
          {job.conflictCount > 0 && onRetryLatest != null ? (
            <Button variant="outline" onClick={onRetryLatest}>
              {batchActionsCopy.categoryRetryLatest}
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>{commonCopy.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
