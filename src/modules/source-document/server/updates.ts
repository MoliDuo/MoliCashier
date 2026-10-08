import { and, asc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { ledgerEntries, ledgers, books, sourceDocuments } from "@/persistence";
import type { BatchUpdateSourceDocumentsResultDto } from "@/modules/source-document/contracts";
import type { BatchUpdateSourceDocumentsInput as BatchUpdateSourceDocumentsPayload } from "@/modules/source-document/contract-schemas";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { recordAiCorrectionsInTransaction } from "@/modules/ledger/server/ai-corrections";
import { replaceDocumentEntriesInTransaction } from "./projections/manual-entries";
import { assertSourceDocumentsNotProcessing } from "./write-guards";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  lockSourceDocumentsForUpdate,
  type LockedSourceDocument,
} from "@/lib/db/transaction-locks";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";

export type AssignBookResult = { ok: true } | { ok: false; reason: "book_unavailable" };

/**
 * Moves a record to another book. The book is not part of the record's
 * versioned content (title, date and entries), so the move leaves the document
 * version as it is.
 */
export async function assignSourceDocumentBook(input: {
  sourceDocumentId: string;
  bookId: string;
}): Promise<AssignBookResult> {
  return db.transaction(async (tx) => {
    // The ledger row is locked first, like every other aggregate command, so a
    // concurrent book edit and a concurrent processing write cannot interleave.
    await lockLedgerForUpdate(tx);
    const document = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    if (document.bookId === input.bookId) return { ok: true as const };
    // Checked inside the transaction, not by the caller: a book archived while
    // the form sat open must not silently receive the record, and only here is
    // the row known to still be live. The foreign key would accept an
    // archived book, so the archived check cannot be left to the database.
    const target = await tx
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, input.bookId), isNull(books.archivedAt)))
      .limit(1)
      .then((rows) => rows[0]);
    if (target == null) return { ok: false as const, reason: "book_unavailable" as const };
    const [updated] = await tx
      .update(sourceDocuments)
      .set({ bookId: input.bookId, updatedAt: new Date() })
      .where(eq(sourceDocuments.id, input.sourceDocumentId))
      .returning({ id: sourceDocuments.id });
    if (updated == null) throw new ConflictError("Source document changed during book edit");
    return { ok: true as const };
  });
}

interface BatchUpdateSourceDocumentsInput {
  sourceDocumentIds: string[];
  data: BatchUpdateSourceDocumentsPayload;
  ledgerEntryIds?: string[];
}

type QueryExecutor = Pick<typeof db, "select">;

/**
 * Caches the rates the documents' foreign-currency entries are read at once
 * they move to `entryDate`. Best effort: the edit commits either way.
 */
async function ensureRatesForDateChange(
  sourceDocumentIds: readonly string[],
  entryDate: string
): Promise<void> {
  const foreign = await db
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .crossJoin(ledgers)
    .where(
      and(
        inArray(ledgerEntries.sourceDocumentId, [...sourceDocumentIds]),
        sql`${ledgerEntries.currency} <> ${ledgers.mainCurrency}`
      )
    )
    .limit(1);
  if (foreign.length > 0) await ensureExchangeRates([entryDate]);
}

export async function updateSourceDocuments({
  sourceDocumentIds: requestedIds,
  data,
  ledgerEntryIds: selectedLedgerEntryIds,
}: BatchUpdateSourceDocumentsInput): Promise<
  BatchUpdateSourceDocumentsResultDto & { impact?: BatchEntryDateImpact }
> {
  const initialDocuments = await db
    .select({
      id: sourceDocuments.id,
      latestAttemptId: sourceDocuments.latestAttemptId,
      title: sourceDocuments.title,
      documentDate: sourceDocuments.documentDate,
    })
    .from(sourceDocuments)
    .where(inArray(sourceDocuments.id, requestedIds))
    .orderBy(asc(sourceDocuments.id));
  if (initialDocuments.length !== requestedIds.length) {
    throw new ConflictError("Source document is not editable");
  }
  const changedDateIds = new Set(
    initialDocuments
      .filter(
        (document) => data.documentDate !== undefined && document.documentDate !== data.documentDate
      )
      .map((document) => document.id)
  );
  const dateChange = data.documentDate !== undefined && changedDateIds.size > 0;
  if (dateChange) {
    await ensureRatesForDateChange([...changedDateIds], data.documentDate!);
  }

  const transactionResult = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);

    let documents: LockedSourceDocument[];
    try {
      documents = await lockSourceDocumentsForUpdate(tx, requestedIds);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new ConflictError("Source documents changed before the batch edit");
      }
      throw error;
    }
    let impact: BatchEntryDateImpact | undefined;
    if (selectedLedgerEntryIds != null) {
      const selectedIds = [...new Set(selectedLedgerEntryIds)].sort();
      const selected = await tx
        .select({ id: ledgerEntries.id, sourceDocumentId: ledgerEntries.sourceDocumentId })
        .from(ledgerEntries)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
        .where(inArray(ledgerEntries.id, selectedIds));
      const selectedDocumentIds = [
        ...new Set(
          selected.flatMap((entry) =>
            entry.sourceDocumentId == null ? [] : [entry.sourceDocumentId]
          )
        ),
      ].sort();
      if (
        selected.length !== selectedIds.length ||
        selectedDocumentIds.length !== requestedIds.length ||
        selectedDocumentIds.some((id, index) => id !== requestedIds[index])
      ) {
        throw new ConflictError("Selected ledger entries changed before the date update");
      }
      const affected = await tx
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
        .where(inArray(ledgerEntries.sourceDocumentId, requestedIds));
      impact = {
        selectedEntryCount: selected.length,
        sourceDocumentCount: requestedIds.length,
        affectedEntryCount: affected.length,
        sourceDocumentIds: requestedIds,
      };
    }

    if (dateChange) {
      if (
        initialDocuments.length !== documents.length ||
        initialDocuments.some((initial, index) => {
          const current = documents[index];
          return (
            current == null ||
            initial.id !== current.id ||
            initial.latestAttemptId !== current.latestAttemptId
          );
        })
      ) {
        throw new ConflictError("Source documents changed before the batch edit");
      }

      const projectionEntries = await loadProjectionEntriesForDocuments(tx, requestedIds);
      // Every requested document must be in a valid state for the batch to
      // commit — but only documents whose title or date actually changes get
      // a new attempt; a document already at the target date/title is a
      // true no-op and keeps its current version untouched.
      const changedDocuments = documents.filter((document) => {
        return (
          (data.title !== undefined && data.title !== document.title) ||
          data.documentDate !== document.documentDate
        );
      });
      for (const document of changedDocuments) {
        const entries = projectionEntries.filter((entry) => entry.sourceDocumentId === document.id);
        await replaceDocumentEntriesInTransaction(tx, {
          document,
          previousEntries: entries,
          sourceDocumentId: document.id,
          entryDate: data.documentDate!,
          ...(data.title === undefined ? {} : { title: data.title }),
          entries: entries.map((entry) => ({
            id: entry.id,
            categoryId: entry.categoryId,
            amount: entry.amount,
            currency: entry.currency,
            itemName: entry.itemName,
            description: entry.description,
            createdAt: entry.createdAt.toISOString(),
          })),
        });
      }
      return { changedIds: new Set(changedDocuments.map((document) => document.id)), impact };
    }

    // Title-only batch: only documents whose title actually differs get a
    // single-writer `+1`; documents already at the target title are no-ops.
    const changedDocuments = documents.filter(
      (document) => data.title !== undefined && data.title !== document.title
    );
    if (changedDocuments.length > 0) {
      // A parse that completes writes its own title, so a title typed while it
      // runs would be lost; refuse it like every other hand edit.
      await assertSourceDocumentsNotProcessing(tx, changedDocuments);
      const updated = await tx
        .update(sourceDocuments)
        .set({
          title: data.title,
          version: sql`${sourceDocuments.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          inArray(
            sourceDocuments.id,
            changedDocuments.map((document) => document.id)
          )
        )
        .returning({ id: sourceDocuments.id });
      if (updated.length !== changedDocuments.length) {
        throw new ConflictError("Source documents changed during the batch edit");
      }
      for (const document of changedDocuments) {
        await recordAiCorrectionsInTransaction(tx, {
          sourceDocumentId: document.id,
          previousTitle: document.title,
          nextTitle: data.title,
        });
      }
    }
    return { changedIds: new Set(changedDocuments.map((document) => document.id)), impact };
  });

  return {
    sourceDocumentIds: requestedIds,
    updatedCount: transactionResult.changedIds.size,
    ...(transactionResult.impact == null ? {} : { impact: transactionResult.impact }),
  };
}

export async function updateLedgerEntryDates(input: {
  sourceDocumentIds: string[];
  ledgerEntryIds: string[];
  entryDate: string;
}): Promise<{ impact: BatchEntryDateImpact }> {
  const selectedIds = [...new Set(input.ledgerEntryIds)].sort();
  const selected = await db
    .select({ id: ledgerEntries.id, sourceDocumentId: ledgerEntries.sourceDocumentId })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(inArray(ledgerEntries.id, selectedIds));
  if (selected.length !== selectedIds.length) throw new NotFoundError("Selected ledger entry");
  const sourceDocumentIds = [
    ...new Set(
      selected.flatMap((entry) => (entry.sourceDocumentId == null ? [] : [entry.sourceDocumentId]))
    ),
  ].sort();
  const targetIds = input.sourceDocumentIds;
  if (
    sourceDocumentIds.length !== targetIds.length ||
    sourceDocumentIds.some((id, index) => id !== targetIds[index])
  ) {
    throw new NotFoundError("Source document target");
  }
  const result = await updateSourceDocuments({
    sourceDocumentIds: input.sourceDocumentIds,
    ledgerEntryIds: selectedIds,
    data: { documentDate: input.entryDate },
  });
  if (result.impact == null) throw new ConflictError("Date update impact was not committed");
  return { impact: result.impact };
}

function loadProjectionEntriesForDocuments(
  executor: QueryExecutor,
  sourceDocumentIds: readonly string[]
) {
  return executor
    .select(getTableColumns(ledgerEntries))
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(inArray(ledgerEntries.sourceDocumentId, [...sourceDocumentIds]))
    .orderBy(ledgerEntries.sourceDocumentId, ledgerEntries.position, ledgerEntries.id);
}
