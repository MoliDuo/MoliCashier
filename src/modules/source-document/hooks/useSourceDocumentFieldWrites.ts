"use client";

import { useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import type { DocumentPatch } from "@/modules/source-document/detail-types";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import type { EntryEditData } from "@/modules/source-document/types";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

/** Values being written, shown in place of the saved ones until the write settles. */
interface PendingWrites {
  document: DocumentPatch;
  entries: Record<string, Partial<EntryEditData>>;
}

const NO_PENDING_WRITES: PendingWrites = { document: {}, entries: {} };

function withoutKeys<T extends object>(value: T, keys: readonly string[]): T {
  const next = { ...value } as Record<string, unknown>;
  for (const key of keys) delete next[key];
  return next as T;
}

/** The fields of a patch that differ from what is saved. */
function changedFields<T extends object>(saved: T, patch: Partial<T>): Partial<T> {
  const changed: Partial<T> = {};
  for (const [key, value] of Object.entries(patch) as [keyof T, T[keyof T]][]) {
    if (value !== saved[key]) changed[key] = value;
  }
  return changed;
}

/**
 * The record sheet's field-by-field writes: the record's title and date, and
 * each entry's fields. The value being written shows in place until the write
 * settles; a failed write reads the record again. The caller decides whether
 * the record may be edited at all.
 */
export function useSourceDocumentFieldWrites({
  id,
  detailKey,
  sourceDocument,
  savedEntries,
  refetch,
}: {
  id: string;
  detailKey: QueryKey;
  sourceDocument: SourceDocumentDetailDto | null;
  savedEntries: readonly LedgerEntryDto[];
  refetch: () => Promise<{ data?: SourceDocumentDetailDto | null | undefined }>;
}) {
  const [pending, setPending] = useState<PendingWrites>(NO_PENDING_WRITES);

  // The sheet reports these failures itself, next to the field or row they were about.
  const documentMutation = useLedgerMutation<unknown, DocumentPatch>({
    errorMessage: null,
    mutationFn: (data) => batchUpdateSourceDocumentsAction({ sourceDocumentIds: [id], data }),
    waitFor: detailKey,
  });
  const entryMutation = useLedgerMutation<
    unknown,
    { entryId: string; patch: Partial<EntryEditData> }
  >({
    errorMessage: null,
    mutationFn: ({ entryId, patch }) => batchUpdateLedgerEntriesAction([id], [entryId], patch),
    waitFor: detailKey,
  });

  /**
   * A failed write reads the record again, so what is shown is what is saved.
   * An entry that is no longer there was replaced by a run, and the reader is
   * told the record changed rather than that their edit failed.
   */
  const reportFailedWrite = async (entryId?: string) => {
    const result = await refetch();
    const entryGone =
      entryId != null &&
      result.data != null &&
      !result.data.ledgerEntries.some((entry) => entry.id === entryId);
    toast.error(entryGone ? sourceDocumentDetailCopy.entryReplaced : commonCopy.saveFailed);
  };

  const updateDocument = async (patch: DocumentPatch) => {
    if (sourceDocument == null) return;
    const changed = changedFields<DocumentPatch>(
      { title: sourceDocument.title ?? "", documentDate: sourceDocument.documentDate },
      patch
    );
    if (changed.title !== undefined && changed.title.trim() === "") return;
    const keys = Object.keys(changed);
    if (keys.length === 0) return;
    setPending((current) => ({ ...current, document: { ...current.document, ...changed } }));
    try {
      await documentMutation.mutateAsync(changed);
    } catch {
      await reportFailedWrite();
    } finally {
      setPending((current) => ({ ...current, document: withoutKeys(current.document, keys) }));
    }
  };

  const updateEntry = async (entryId: string, patch: Partial<EntryEditData>) => {
    const saved = savedEntries.find((entry) => entry.id === entryId);
    if (saved == null || pending.entries[entryId] != null) return;
    const changed = changedFields<EntryEditData>(
      {
        itemName: saved.itemName,
        amount: saved.amount,
        currency: saved.currency ?? "",
        categoryId: saved.categoryId,
        description: saved.description,
      },
      patch
    );
    if (changed.itemName !== undefined && changed.itemName.trim() === "") return;
    if (Object.keys(changed).length === 0) return;
    setPending((current) => ({ ...current, entries: { ...current.entries, [entryId]: changed } }));
    try {
      await entryMutation.mutateAsync({ entryId, patch: changed });
    } catch {
      await reportFailedWrite(entryId);
    } finally {
      setPending((current) => ({ ...current, entries: withoutKeys(current.entries, [entryId]) }));
    }
  };

  return { pending, updateDocument, updateEntry };
}
