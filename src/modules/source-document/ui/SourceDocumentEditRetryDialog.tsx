"use client";
import { useCallback, useMemo, useState } from "react";
import { textRoleClassName } from "@/components/typography";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SourceDocumentInput } from "./SourceDocumentInput";
import { useQuery } from "@tanstack/react-query";
import { fetchSourceDocumentInput } from "@/modules/source-document/queries";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  buildSourceDocumentRetrySeed,
  type RetrySeedSourceDocument,
} from "./source-document-retry-seed";
import { sourceDocumentEditRetryDialogCopy } from "@/copy/source-document";

interface SourceDocumentEditRetryDialogProps {
  sourceDocument: RetrySeedSourceDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onPendingChange?: (pending: boolean) => void;
}

export function SourceDocumentEditRetryDialog(props: SourceDocumentEditRetryDialogProps) {
  return props.open ? <EditRetryDialogContent key={props.sourceDocument.id} {...props} /> : null;
}

function EditRetryDialogContent({
  sourceDocument: sourceDocumentProp,
  open,
  onOpenChange,
  onSuccess,
  onPendingChange,
}: SourceDocumentEditRetryDialogProps) {
  const [sourceDocument] = useState(sourceDocumentProp);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handlePendingChange = useCallback(
    (pending: boolean) => {
      setIsSubmitting(pending);
      onPendingChange?.(pending);
    },
    [onPendingChange]
  );

  // Closing keeps what was typed: the form stores it as a draft for this
  // record and restores it the next time the dialog opens.
  const requestClose = () => {
    if (!isSubmitting) onOpenChange(false);
  };

  const hasStoredFiles = (sourceDocument.files?.length ?? 0) > 0;
  const hasText = sourceDocument.text != null && sourceDocument.text !== "";
  const needsFetch =
    (!hasStoredFiles && sourceDocument.hasImages === true) || (!hasStoredFiles && !hasText);

  const {
    data: inputData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.sourceDocumentInput(sourceDocument.id),
    queryFn: async () => {
      const result = await fetchSourceDocumentInput(sourceDocument.id);
      if (result == null) return null;
      return result;
    },
    enabled: open && needsFetch,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  const initialData = useMemo(
    () => buildSourceDocumentRetrySeed(sourceDocument, inputData ?? undefined),
    [sourceDocument, inputData]
  );
  const seedReady = !needsFetch || inputData != null;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
      <DialogContent
        variant="detail"
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:rounded-lg"
        aria-describedby={undefined}
        hideCloseButton={isSubmitting}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-12 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{sourceDocumentEditRetryDialogCopy.title}</DialogTitle>
        </DialogHeader>
        <div
          className="relative min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6"
          aria-busy={isLoading || isFetching}
        >
          {isLoading ? (
            <EditRetryDialogSkeleton />
          ) : !seedReady ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <p className={textRoleClassName("body", "text-destructive")} role="alert">
                {sourceDocumentEditRetryDialogCopy.loadError}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
                {sourceDocumentEditRetryDialogCopy.reload}
              </Button>
            </div>
          ) : (
            <div className="relative">
              <SourceDocumentInput
                mode="retry"
                sourceDocumentId={sourceDocument.id}
                draftBasis={sourceDocument.latestAttemptId}
                initialData={initialData}
                onPendingChange={handlePendingChange}
                onSuccess={() => {
                  onOpenChange(false);
                  onSuccess?.();
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Skeleton loading state for the edit-retry dialog */
function EditRetryDialogSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Image preview skeleton */}
      <div className="grid grid-cols-4 gap-2">
        {[1, 2].map((idx) => (
          <div key={idx} className="aspect-square rounded-md bg-surface2 border border-border" />
        ))}
      </div>
      {/* Textarea skeleton */}
      <div className="h-[120px] rounded-md bg-surface2 border border-border" />
      {/* Advanced features fold skeleton */}
      <div className="h-10 rounded-lg bg-surface2 border border-border" />
      {/* Action buttons skeleton */}
      <div className="flex items-center gap-2">
        <div className="h-9 w-20 rounded-md bg-surface2" />
        <div className="flex-1" />
        <div className="h-9 w-24 rounded-md bg-surface2" />
      </div>
    </div>
  );
}
