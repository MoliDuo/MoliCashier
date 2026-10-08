"use client";

import { useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { openLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import type { useSelection } from "@/hooks/use-selection";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  createLedgerEntryAction,
  deleteLedgerEntryAction,
} from "@/modules/ledger/server-actions/entries";
import type {
  PartialBatchCommandResult,
  SourceDocumentDetailDto,
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import type { AddEntryData } from "@/modules/source-document/detail-types";
import { splitSourceDocumentAction } from "@/modules/source-document/server-actions/split";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

type BatchPatch = { categoryId: string | null } | { currency: string };

/**
 * The commands on the record's entries: adding and deleting one, and the
 * batch actions on the selected ones (category, currency, delete, split). The
 * caller decides whether the record may be changed at all.
 */
export function useSourceDocumentEntryCommands({
  id,
  detailKey,
  savedEntries,
  selection,
  commitDetailSnapshot,
}: {
  id: string;
  detailKey: QueryKey;
  savedEntries: readonly LedgerEntry[];
  selection: ReturnType<typeof useSelection>;
  commitDetailSnapshot: (document: SourceDocumentDetailDto) => Promise<void>;
}) {
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showAddEntryDialog, setShowAddEntryDialog] = useState(false);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);

  // The sheet reports these failures itself, next to the row or selection they were about.
  const splitMutation = useLedgerMutation<
    SplitSourceDocumentResultDto,
    Omit<SplitSourceDocumentInput, "sourceDocumentId">
  >({
    errorMessage: null,
    waitFor: false,
    mutationFn: (input) => splitSourceDocumentAction({ sourceDocumentId: id, ...input }),
    onSuccess: (result) => commitDetailSnapshot(result.sourceDocument),
  });
  const addEntryMutation = useLedgerMutation<{ ledgerEntryId: string }, AddEntryData>({
    errorMessage: null,
    mutationFn: (data) => createLedgerEntryAction({ sourceDocumentId: id, ...data }),
    waitFor: detailKey,
  });
  const deleteEntryMutation = useLedgerMutation<{ ledgerEntryId: string; deleted: true }, string>({
    errorMessage: null,
    mutationFn: (entryId) => deleteLedgerEntryAction(id, entryId),
    waitFor: detailKey,
  });
  const batchUpdateMutation = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { ids: string[]; patch: BatchPatch }
  >({
    errorMessage: null,
    mutationFn: ({ ids, patch }) => batchUpdateLedgerEntriesAction([id], ids, patch),
    waitFor: detailKey,
  });
  const batchDeleteMutation = useLedgerMutation<PartialBatchCommandResult, string[]>({
    errorMessage: null,
    mutationFn: (entryIds) => batchDeleteLedgerEntriesAction([id], entryIds),
    waitFor: detailKey,
  });

  const batchPatch = async (patch: BatchPatch) => {
    if (selection.selectedIds.length === 0) return;
    try {
      const result = await batchUpdateMutation.mutateAsync({ ids: selection.selectedIds, patch });
      if (result.affectedCount > 0) {
        toast.success(sourceDocumentDetailCopy.batchUpdateSuccess({ count: result.affectedCount }));
      }
      selection.clearSelection();
    } catch {
      toast.error(sourceDocumentDetailCopy.batchUpdateError);
    }
  };

  const batchDelete = async () => {
    try {
      const result = await batchDeleteMutation.mutateAsync(selection.selectedIds);
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) selection.clearSelection();
      else selection.retainSelection(unresolved);
      if (result.succeeded.length > 0) {
        toast.success(
          sourceDocumentDetailCopy.batchDeleteSuccess({ count: result.succeeded.length })
        );
      }
      if (unresolved.length > 0) {
        toast.error(sourceDocumentDetailCopy.batchDeletePartial({ count: unresolved.length }));
        return false;
      }
      setShowBatchDeleteConfirm(false);
      return true;
    } catch {
      toast.error(sourceDocumentDetailCopy.batchDeleteError);
      return false;
    }
  };

  const feedbackToastId = `source-document-entry:${id}`;

  const openSplit = () => {
    if (selection.selectedIds.length === 0) return;
    if (selection.selectedIds.length >= savedEntries.length) {
      toast.error(sourceDocumentDetailCopy.splitKeepOne);
      return;
    }
    setShowSplitDialog(true);
  };

  const split = async (entryDate: string) => {
    try {
      const result = await splitMutation.mutateAsync({
        ledgerEntryIds: selection.selectedIds,
        entryDate,
      });
      setShowSplitDialog(false);
      selection.clearSelection();
      toast.success(sourceDocumentDetailCopy.splitSuccess({ count: result.movedEntryCount }), {
        id: feedbackToastId,
        action: {
          label: sourceDocumentDetailCopy.viewSplitBill,
          // The new record replaces this one in the sheet; Back still lands on the list.
          onClick: () => openLedgerDetail(result.splitSourceDocumentId),
        },
      });
    } catch {
      toast.error(sourceDocumentDetailCopy.splitFailed);
    }
  };

  const addEntry = async (data: AddEntryData): Promise<boolean> => {
    try {
      await addEntryMutation.mutateAsync(data);
      toast.success(sourceDocumentDetailCopy.addEntrySuccess, {
        id: feedbackToastId,
        action: null,
      });
      return true;
    } catch {
      toast.error(sourceDocumentDetailCopy.addEntryError);
      return false;
    }
  };

  const deleteEntry = async (entryId: string): Promise<boolean> => {
    try {
      await deleteEntryMutation.mutateAsync(entryId);
      setPendingDeleteEntryId(null);
      toast.success(commonCopy.deleteSuccess, { id: feedbackToastId, action: null });
      return true;
    } catch {
      toast.error(commonCopy.deleteFailed);
      return false;
    }
  };

  return {
    isBatchUpdating: batchUpdateMutation.isPending,
    isBatchDeleting: batchDeleteMutation.isPending,
    isSplitting: splitMutation.isPending,
    isAddingEntry: addEntryMutation.isPending,
    batchPatch,
    batchDelete,
    openSplit,
    split,
    addEntry,
    deleteEntry,
    dialogs: {
      showBatchDeleteConfirm,
      setShowBatchDeleteConfirm,
      showSplitDialog,
      setShowSplitDialog,
      showAddEntryDialog,
      setShowAddEntryDialog,
      pendingDeleteEntryId,
      setPendingDeleteEntryId,
    },
  };
}
