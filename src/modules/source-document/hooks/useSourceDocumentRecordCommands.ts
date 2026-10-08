"use client";

import { useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy } from "@/copy/source-document";

/**
 * The commands on the record as a whole: deleting it, cancelling or retrying
 * its processing, and moving it to another book. The caller decides whether the
 * record may be changed at all.
 */
export function useSourceDocumentRecordCommands({
  id,
  detailKey,
  onClose,
}: {
  id: string;
  detailKey: QueryKey;
  onClose: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [isEditRetrying, setIsEditRetrying] = useState(false);

  const deleteDocumentMutation = useLedgerMutation<unknown, void>({
    waitFor: false,
    mutationFn: () => deleteSourceDocumentAction(id),
    successMessage: commonCopy.deleteSuccess,
    errorMessage: commonCopy.deleteFailed,
    onSuccess: () => {
      setShowDeleteConfirm(false);
      onClose();
    },
  });
  const cancelMutation = useLedgerMutation<unknown, void>({
    mutationFn: () => cancelSourceDocumentProcessingAction(id),
    successMessage: sourceDocumentActionCopy.cancelSuccess,
    errorMessage: sourceDocumentActionCopy.cancelError,
  });
  const retryMutation = useLedgerMutation<unknown, void>({
    mutationFn: () => retrySourceDocumentAction(id),
    waitFor: detailKey,
    successMessage: sourceDocumentActionCopy.retrySuccess,
    errorMessage: sourceDocumentActionCopy.retryError,
  });
  const assignBookMutation = useLedgerMutation({
    // An archived target says so instead of snapping the picker back silently.
    errorMessage: commonCopy.bookChangeFailed,
    mutationFn: (bookId: string) =>
      assignSourceDocumentBookAction({ sourceDocumentId: id, bookId }),
    waitFor: detailKey,
  });

  const deleteDocument = async () => {
    try {
      await deleteDocumentMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    }
  };

  // A cancel can be tapped twice before its pending state renders.
  const cancelLockRef = useRef(false);
  const cancelProcessing = async () => {
    if (cancelLockRef.current) return;
    cancelLockRef.current = true;
    try {
      await cancelMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    } finally {
      cancelLockRef.current = false;
    }
  };

  const retry = async () => {
    try {
      await retryMutation.mutateAsync();
    } catch {
      // The mutation already reported the failure.
    }
  };

  return {
    isDeleting: deleteDocumentMutation.isPending,
    isCancelling: cancelMutation.isPending,
    isRetrying: retryMutation.isPending,
    isEditRetrying,
    setIsEditRetrying,
    isAssigningBook: assignBookMutation.isPending,
    assignBook: (bookId: string) => assignBookMutation.mutate(bookId),
    deleteDocument,
    cancelProcessing,
    retry,
    dialogs: { showDeleteConfirm, setShowDeleteConfirm, showRetryDialog, setShowRetryDialog },
  };
}
