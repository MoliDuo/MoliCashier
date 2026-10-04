import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { books, ledgers, sourceDocuments } from "@/persistence";
import { NotFoundError, ValidationError } from "@/lib/errors";

/** Drizzle transaction client type shared by every transactional server function. */
export type PostgresTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock order convention:
 *   ledger → source document
 *
 * When a transaction must lock both rows, always lock the ledger row first to prevent deadlocks.
 * Use these helpers inside existing Drizzle transactions — they issue `SELECT ... FOR UPDATE`
 * which holds the row lock until the enclosing transaction commits or rolls back.
 */

/**
 * Acquire a FOR UPDATE row lock on the ledger row.
 * Returns its main currency, the one setting a locked writer reads.
 * Throws {@link NotFoundError} when the ledger does not exist.
 */
export async function lockLedgerForUpdate(
  tx: PostgresTransaction
): Promise<{ mainCurrency: string }> {
  const rows = await tx.select({ mainCurrency: ledgers.mainCurrency }).from(ledgers).for("update");

  if (rows.length === 0) {
    throw new NotFoundError("Ledger");
  }

  return rows[0]!;
}

/**
 * Re-read the book a record is being filed into under a `FOR SHARE` lock, so
 * the write transaction sees a stable answer: a concurrent archive holds the
 * ledger row (locked first by the caller) while it works, so this either runs
 * before it and sees a live book, or after it and refuses. A shared lock is
 * enough — the caller only needs the row not to change underneath, not to edit
 * it — and lets two records into the same book commit in parallel.
 * Throws {@link NotFoundError} when the book does not exist or was archived
 * before this transaction took the ledger lock.
 */
export async function lockBookForShare(tx: PostgresTransaction, bookId: string): Promise<void> {
  const rows = await tx
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.id, bookId), isNull(books.archivedAt)))
    .for("share");

  if (rows.length === 0) {
    throw new NotFoundError("Book");
  }
}

// The document columns a locked writer re-reads; the input text and
// suggestions stay unread.
const lockedSourceDocumentColumns = {
  id: sourceDocuments.id,
  bookId: sourceDocuments.bookId,
  version: sourceDocuments.version,
  title: sourceDocuments.title,
  documentDate: sourceDocuments.documentDate,
  latestAttemptId: sourceDocuments.latestAttemptId,
  dateOrganizationSuggestion: sourceDocuments.dateOrganizationSuggestion,
  duplicateSuggestion: sourceDocuments.duplicateSuggestion,
};

export type LockedSourceDocument = Pick<
  typeof sourceDocuments.$inferSelect,
  keyof typeof lockedSourceDocumentColumns
>;

/**
 * Acquire a FOR UPDATE row lock on the target source document row.
 * Returns the columns callers re-read without an extra round-trip.
 * Throws {@link NotFoundError} when the document does not exist.
 */
export async function lockSourceDocumentForUpdate(
  tx: PostgresTransaction,
  sourceDocumentId: string
): Promise<LockedSourceDocument> {
  const rows = await tx
    .select(lockedSourceDocumentColumns)
    .from(sourceDocuments)
    .where(eq(sourceDocuments.id, sourceDocumentId))
    .for("update");

  if (rows.length === 0) {
    throw new NotFoundError("Source document");
  }

  return rows[0]!;
}

/**
 * Acquire `FOR UPDATE` row locks on multiple source-document rows in a single
 * query, always in ascending ID order — the fixed order is what prevents
 * deadlocks when several transactions lock overlapping document sets.
 * Throws {@link ValidationError} for a duplicate ID (a programming error: no
 * caller ever legitimately targets the same document twice in one command)
 * and {@link NotFoundError} when any requested document does not exist.
 */
export async function lockSourceDocumentsForUpdate(
  tx: PostgresTransaction,
  sourceDocumentIds: readonly string[]
): Promise<LockedSourceDocument[]> {
  const uniqueIds = new Set(sourceDocumentIds);
  if (uniqueIds.size !== sourceDocumentIds.length) {
    throw new ValidationError("A source document may only be locked once per command");
  }
  const orderedIds = [...uniqueIds].sort();

  const rows = await tx
    .select(lockedSourceDocumentColumns)
    .from(sourceDocuments)
    .where(inArray(sourceDocuments.id, orderedIds))
    .orderBy(asc(sourceDocuments.id))
    .for("update");

  if (rows.length !== orderedIds.length) {
    throw new NotFoundError("Source document");
  }

  return rows;
}
