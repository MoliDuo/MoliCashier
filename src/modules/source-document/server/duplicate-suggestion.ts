import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import { sourceDocuments } from "@/persistence";
import type {
  ApplyDuplicateSuggestionInput,
  ApplyDuplicateSuggestionResultDto,
  DismissDuplicateSuggestionInput,
} from "@/modules/source-document/contracts";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";
import { assertSourceDocumentsNotProcessing } from "./write-guards";
import { listProjectionEntries, toProjectionEntry } from "./entry-commands";
import { replaceDocumentEntriesInTransaction } from "./projections/manual-entries";
import { getSourceDocumentInTransaction } from "./reads/list";

/** Keeps the entries and drops the suggestion; it is not part of the record's content. */
export async function dismissDuplicateSuggestion(
  input: DismissDuplicateSuggestionInput
): Promise<{ dismissed: true }> {
  const current = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, input.sourceDocumentId),
    columns: { id: true },
  });
  if (current == null) throw new NotFoundError("Source document");
  await db
    .update(sourceDocuments)
    .set({ duplicateSuggestion: null })
    .where(
      and(
        eq(sourceDocuments.id, input.sourceDocumentId),
        sql`${sourceDocuments.duplicateSuggestion}->>'id' = ${input.suggestionId}`
      )
    );
  return { dismissed: true };
}

/**
 * Removes the entries the suggestion flagged. An entry the owner has changed
 * since the parse stays, since it is no longer the row that was flagged. When
 * nothing else would be left, the record goes with them.
 */
export async function applyDuplicateSuggestion(
  input: ApplyDuplicateSuggestionInput
): Promise<ApplyDuplicateSuggestionResultDto> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const document = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    if (document.duplicateSuggestion?.id !== input.suggestionId) {
      throw new ConflictError("Duplicate suggestion is no longer current");
    }
    await assertSourceDocumentsNotProcessing(tx, [document]);
    const entries = await listProjectionEntries(tx, document.id);
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const removedIds = new Set(
      document.duplicateSuggestion.items.flatMap((item) => {
        const entry = entriesById.get(item.ledgerEntryId);
        return entry != null &&
          entry.itemName === item.snapshot.itemName &&
          compare(entry.amount, item.snapshot.amount) === 0 &&
          entry.currency === item.snapshot.currency
          ? [entry.id]
          : [];
      })
    );
    if (removedIds.size === 0) {
      throw new ConflictError("The flagged entries changed before they were removed");
    }
    if (removedIds.size === entries.length) {
      await tx.delete(sourceDocuments).where(eq(sourceDocuments.id, document.id));
      return { removedCount: removedIds.size, deleted: true, sourceDocument: null };
    }
    await replaceDocumentEntriesInTransaction(tx, {
      document,
      previousEntries: entries,
      sourceDocumentId: document.id,
      entries: entries.filter((entry) => !removedIds.has(entry.id)).map(toProjectionEntry),
    });
    const sourceDocument = await getSourceDocumentInTransaction(tx, document.id);
    if (sourceDocument == null) throw new NotFoundError("Source document");
    return { removedCount: removedIds.size, deleted: false, sourceDocument };
  });
}
