import { and, eq, inArray, sql } from "drizzle-orm";
import "server-only";
import type { ActivateAttemptInput } from "@/modules/source-document/server/projections/types";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { extractionAttempts, ledgerEntries, sourceDocuments } from "@/persistence";
import type { DuplicateSuggestion } from "@/lib/ai/duplicate-suggestion";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  type LockedSourceDocument,
} from "@/lib/db/transaction-locks";
import { closeProcessingLeaseInTransaction } from "@/server/processing/terminal";

import { activeDocumentWhere, replaceProjection } from "./shared";

/** The suggestion without items whose recorded counterpart was deleted while the parse ran. */
async function stillMatchedSuggestion(
  tx: PostgresTransaction,
  suggestion: DuplicateSuggestion | null | undefined
): Promise<DuplicateSuggestion | null> {
  if (suggestion == null) return null;
  const matchedIds = suggestion.items.map((item) => item.matched.ledgerEntryId);
  const present = new Set(
    await tx
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(inArray(ledgerEntries.id, matchedIds))
      .then((rows) => rows.map((row) => row.id))
  );
  const items = suggestion.items.filter((item) => present.has(item.matched.ledgerEntryId));
  return items.length === 0 ? null : { ...suggestion, items };
}

export async function activateAttempt(input: ActivateAttemptInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The ledger lock keeps the categories the entries reference from being
    // deleted underneath the activation.
    await lockLedgerForUpdate(tx);

    // Also lock the source document row to serialise with a concurrent delete.
    // Lock order: ledger → source document (prevents deadlocks).
    let document: LockedSourceDocument;
    try {
      document = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
    if (document.latestAttemptId !== input.attemptId) return false;
    const attempt = await tx
      .select()
      .from(extractionAttempts)
      .where(
        and(
          eq(extractionAttempts.sourceDocumentId, input.sourceDocumentId),
          eq(extractionAttempts.id, input.attemptId)
        )
      )
      .for("update")
      .then((rows) => rows[0]);
    if (attempt == null || attempt.status !== "processing") {
      return false;
    }
    if (!(await closeProcessingLeaseInTransaction(tx, input.lease))) {
      return false;
    }

    await replaceProjection(tx, {
      sourceDocumentId: input.sourceDocumentId,
      entries: input.entries,
    });
    const duplicateSuggestion = await stillMatchedSuggestion(tx, input.duplicateSuggestion);
    const now = new Date();
    await tx
      .update(extractionAttempts)
      .set({
        status: "completed",
        finishedAt: now,
        failureKind: null,
        failureMessage: null,
        failureCode: null,
      })
      .where(eq(extractionAttempts.id, input.attemptId));
    await tx
      .update(sourceDocuments)
      .set({
        version: sql`${sourceDocuments.version} + 1`,
        // A submission without a date keeps the day the record already has.
        ...(attempt.requestedDate == null ? {} : { documentDate: attempt.requestedDate }),
        ...(input.title == null || input.title === "" ? {} : { title: input.title }),
        dateOrganizationSuggestion: input.dateOrganizationSuggestion ?? null,
        duplicateSuggestion,
        updatedAt: now,
      })
      .where(activeDocumentWhere(input.sourceDocumentId));
    return true;
  });
}
