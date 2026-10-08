import "server-only";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BookDto } from "@/modules/ledger/contracts";
import { db } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { books, serviceCredentials, sourceDocuments } from "@/persistence";
import { lockLedgerForUpdate } from "@/lib/db/transaction-locks";

type BookRow = typeof books.$inferSelect;

export type ArchiveBookResult =
  { status: "archived"; book: BookDto } | { status: "not_found" } | { status: "has_credentials" };

export type DeleteBookResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "has_records" }
  | { status: "has_credentials" };

/**
 * A 分账. Reading every book together is 总账, a view over all of them rather
 * than a designated one. `archivedAt`
 * set means the book is retired: its records still count in 总账, but it is no
 * longer offered as a target for new ones.
 */
function toBook(row: BookRow): BookDto {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

const liveBooksWhere = isNull(books.archivedAt);

/**
 * The books that are still in use. A retired book may share a name with a live
 * one, so the counts that decide what is allowed always ask about the live rows
 * only.
 */
async function countLiveBooks(tx: Pick<typeof db, "select">): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(books)
    .where(liveBooksWhere);
  return Number(rows[0]?.count ?? 0);
}

/**
 * API keys pointing at the book. Revoked keys (`revoked_at` set) are dead: they
 * cannot upload, they are not listed anywhere, and nothing can be rebound onto
 * them — so only the live ones make a book un-archivable. A hard delete is
 * different: the rows still reference the book either way.
 */
async function countCredentials(
  tx: Pick<typeof db, "select">,
  bookId: string,
  options?: { activeOnly?: boolean }
): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceCredentials)
    .where(
      and(
        eq(serviceCredentials.bookId, bookId),
        ...(options?.activeOnly === true ? [isNull(serviceCredentials.revokedAt)] : [])
      )
    );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Every record the book holds. Deleting the book would have to break the
 * records' foreign key, so this is the count that decides whether a delete is
 * possible at all.
 */
async function countDocuments(tx: Pick<typeof db, "select">, bookId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.bookId, bookId));
  return Number(rows[0]?.count ?? 0);
}

/**
 * The refusal shared by archive and delete: the last live book would leave the
 * instance with nowhere to file anything. Thrown with its own code rather
 * than matched on message text, so rewording it cannot break the caller's error
 * mapping.
 */
async function assertNotLast(tx: Pick<typeof db, "select">): Promise<void> {
  if ((await countLiveBooks(tx)) <= 1) {
    throw new AppError("The last active book cannot be archived", "BOOK_LAST_ACTIVE", 409);
  }
}

function duplicateNameError() {
  return new AppError("A book with that name already exists", "BOOK_NAME_TAKEN", 409);
}

/** Live books in switcher order; archived rows only when asked for. */
export async function listBooks(options?: { includeArchived?: boolean }): Promise<BookDto[]> {
  const rows = await db
    .select()
    .from(books)
    .where(options?.includeArchived === true ? undefined : liveBooksWhere)
    .orderBy(asc(books.sortOrder), asc(books.createdAt), asc(books.id));
  return rows.map(toBook);
}

/** A live book, or null. Write paths use this: an archived book is no target. */
export async function getBook(bookId: string): Promise<BookDto | null> {
  const row = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), isNull(books.archivedAt)))
    .limit(1)
    .then((rows) => rows[0]);
  return row == null ? null : toBook(row);
}

export async function getBookIncludingArchived(bookId: string): Promise<BookDto | null> {
  // Display only: a record may still point at a book that has since been
  // retired, and the detail page has to name it instead of showing a blank.
  const row = await db
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1)
    .then((rows) => rows[0]);
  return row == null ? null : toBook(row);
}

export async function createBook(input: { name: string }): Promise<BookDto> {
  return db.transaction(async (tx) => {
    // Two books created at once would otherwise read the same last position.
    await lockLedgerForUpdate(tx);
    const next = await tx
      .select({ sortOrder: sql<number | null>`max(${books.sortOrder})` })
      .from(books)
      .then((rows) => Number(rows[0]?.sortOrder ?? 0) + 1);
    const created = await tx
      .insert(books)
      .values({
        name: input.name,
        sortOrder: next,
      })
      .onConflictDoNothing()
      .returning()
      .then((rows) => rows[0]);
    if (created == null) throw duplicateNameError();
    return toBook(created);
  });
}

export async function updateBook(bookId: string, input: { name: string }): Promise<BookDto | null> {
  const updated = await db
    .update(books)
    .set({
      name: input.name,
      updatedAt: new Date(),
    })
    .where(and(eq(books.id, bookId), isNull(books.archivedAt)))
    .returning()
    .then((rows) => rows[0])
    .catch((error: unknown) => {
      if (isUniqueViolation(error)) throw duplicateNameError();
      throw error;
    });
  return updated == null ? null : toBook(updated);
}

/** Writes the given order; every live book must appear exactly once. */
export async function reorderBooks(bookIds: readonly string[]): Promise<BookDto[]> {
  return db.transaction(async (tx) => {
    const live = await tx.select({ id: books.id }).from(books).where(liveBooksWhere);
    const liveIds = new Set(live.map((row) => row.id));
    if (liveIds.size !== bookIds.length || bookIds.some((id) => !liveIds.has(id))) {
      throw new AppError(
        "Reorder must list every active book exactly once",
        "BOOK_ORDER_INVALID",
        400
      );
    }
    // One statement rather than one UPDATE per row. Positions come from a
    // VALUES list whose order is the caller's order, so no row can briefly
    // hold another row's position while the rewrite is in flight.
    const positions = sql.join(
      bookIds.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`),
      sql`, `
    );
    await tx.execute(sql`
      UPDATE books AS b
         SET sort_order = ordered.position, updated_at = now()
        FROM (VALUES ${positions}) AS ordered(id, position)
       WHERE b.id = ordered.id
    `);
    const rows = await tx
      .select()
      .from(books)
      .where(liveBooksWhere)
      .orderBy(asc(books.sortOrder), asc(books.createdAt), asc(books.id));
    return rows.map(toBook);
  });
}

/**
 * Retires a book that still holds records; those records keep counting in
 * 总账. Refused for the last active book, and for a book that still has an
 * active API key bound to it.
 */
export async function archiveBook(bookId: string): Promise<ArchiveBookResult> {
  return db.transaction(async (tx) => {
    // Serialises with the record-create paths and with credential rebinds,
    // which all take the same lock: a record filed mid-archive cannot leave
    // the book both retired and freshly written to.
    await lockLedgerForUpdate(tx);
    const book = await tx
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1)
      .then((rows) => rows[0]);
    if (book == null || book.archivedAt != null) return { status: "not_found" as const };
    // An active key bound to the book would keep uploading into a retired
    // book, so it has to be rebound first. Checked before the last-book rule,
    // because the reader can act on this one. Revoked keys stay out: they
    // cannot upload and cannot be rebound, so they would retire the book
    // forever.
    if ((await countCredentials(tx, bookId, { activeOnly: true })) > 0) {
      return { status: "has_credentials" as const };
    }
    await assertNotLast(tx);
    const archived = await tx
      .update(books)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(books.id, bookId), isNull(books.archivedAt)))
      .returning()
      .then((rows) => rows[0]);
    if (archived == null) return { status: "not_found" as const };
    return { status: "archived" as const, book: toBook(archived) };
  });
}

/** Brings an archived book back; the name must be free among the live books. */
export async function restoreBook(bookId: string): Promise<BookDto> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const restored = await tx
      .update(books)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(books.id, bookId), isNotNull(books.archivedAt)))
      .returning()
      .then((rows) => rows[0])
      .catch((error: unknown) => {
        // Bringing a book back can collide with a live book that took its
        // name while it was retired.
        if (isUniqueViolation(error)) throw duplicateNameError();
        throw error;
      });
    if (restored == null) throw new NotFoundError("Book");
    return toBook(restored);
  });
}

/**
 * Removes a book for good. Only reachable for a book with no records at all —
 * soft-deleted ones included — because the records reference it, and for a
 * book with no API keys bound to it.
 */
export async function deleteBook(bookId: string): Promise<DeleteBookResult> {
  return db.transaction(async (tx) => {
    // The same lock the record-create paths take: without it a record filed
    // between the "no records" check and the DELETE would trip the foreign
    // key and surface as an unexpected failure.
    await lockLedgerForUpdate(tx);
    const book = await tx
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1)
      .then((rows) => rows[0]);
    if (book == null) return { status: "not_found" as const };
    // Soft-deleted records count too: the foreign key still points at this
    // book, so removing the row would fail or orphan them.
    if ((await countDocuments(tx, bookId)) > 0) {
      return { status: "has_records" as const };
    }
    if ((await countCredentials(tx, bookId, { activeOnly: true })) > 0) {
      return { status: "has_credentials" as const };
    }
    // Revoked keys still reference the book, so they block a hard delete —
    // but the reader cannot rebind what the UI never lists, so the refusal is
    // the "archive it instead" one rather than an impossible rebinding ask.
    if ((await countCredentials(tx, bookId)) > 0) {
      return { status: "has_records" as const };
    }
    // Deleting is only offered for a live book; an archived one is restored
    // first, so a retired book cannot vanish without the reader seeing it.
    if (book.archivedAt != null) return { status: "not_found" as const };
    await assertNotLast(tx);
    const removed = await tx
      .delete(books)
      .where(eq(books.id, bookId))
      .returning({ id: books.id })
      .then((rows) => rows[0]);
    if (removed == null) return { status: "not_found" as const };
    return { status: "deleted" as const };
  });
}

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose `cause` is the
 * original Postgres error, so the SQLSTATE is one level down from what the
 * caller catches. The live-name unique index is the only one an UPDATE here can
 * trip.
 */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}
