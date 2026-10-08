import { forgetTitleCorrectionInTransaction } from "@/modules/ledger/server/ai-corrections";
import { and, eq, sql } from "drizzle-orm";
import "server-only";
import type { ActivateAttemptInput } from "@/modules/source-document/server/projections/types";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { extractionAttempts, sourceDocuments } from "@/persistence";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  type LockedSourceDocument,
} from "@/lib/db/transaction-locks";
import { closeProcessingLeaseInTransaction } from "@/server/processing/terminal";

import { isFallbackDocumentTitle } from "@/config/ai-output-locales";
import {
  activeDocumentWhere,
  replaceProjection,
  stillMatchedSuggestion,
  withoutMissingCategories,
} from "./shared";

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
      entries: await withoutMissingCategories(
        tx,
        input.entries.map((entry) => ({ ...entry, extracted: true }))
      ),
    });
    // The placeholder the parser falls back to when it found no title never
    // replaces a title the record already has.
    const title =
      input.title == null ||
      input.title === "" ||
      (isFallbackDocumentTitle(input.title) && (document.title ?? "").trim() !== "")
        ? null
        : input.title;
    // The title the AI writes now replaces the one a correction was about.
    if (title != null) {
      await forgetTitleCorrectionInTransaction(tx, input.sourceDocumentId);
    }
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
        ...(title == null ? {} : { title }),
        dateOrganizationSuggestion: input.dateOrganizationSuggestion ?? null,
        duplicateSuggestion,
        updatedAt: now,
      })
      .where(activeDocumentWhere(input.sourceDocumentId));
    return true;
  });
}
