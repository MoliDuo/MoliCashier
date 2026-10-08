import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import {
  archiveBook,
  createBook,
  deleteBook,
  getBook,
  getBookIncludingArchived,
  listBooks,
  reorderBooks,
  restoreBook,
  updateBook,
} from "@/modules/ledger/server/books";
import {
  authenticateServiceCredential,
  createServiceCredential,
  revokeServiceCredential,
  setServiceCredentialBook,
} from "@/modules/ledger/server/service-credentials";
import { books, serviceCredentials, sourceDocuments } from "@/persistence";
import { createTestSourceDocument } from "tests/helpers/schema-setup";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";

/**
 * The 分账 rules the product states, checked against the real adapter: order is
 * the switcher's order, a book with records may only be archived, and the last
 * active book cannot be archived or deleted at all.
 */
describe("books", () => {
  async function fixture() {
    const db = getTestDb();
    await createTestLedger(db);
    const firstBookId = await testBookId(db);
    const created = await createBook({
      name: "梁梁的",
    });
    return { db, firstBookId, secondBookId: created.id };
  }

  it("lists books in switcher order and appends new ones at the end", async () => {
    const { firstBookId } = await fixture();
    const third = await createBook({ name: "哞哞的" });

    const listed = await listBooks();
    expect(listed.map((book) => book.id)).toEqual([firstBookId, expect.any(String), third.id]);
    expect(listed.map((book) => book.sortOrder)).toEqual([1, 2, 3]);
    expect(listed[0]?.name).toBe("共同支出");

    const reordered = await reorderBooks([third.id, firstBookId, listed[1]!.id]);
    expect(reordered.map((book) => book.id)).toEqual([third.id, firstBookId, listed[1]!.id]);
    expect(await listBooks()).toEqual(reordered);
  });

  it("gives books created at the same time their own positions", async () => {
    const { db } = await fixture();

    await Promise.all(["A", "B", "C", "D"].map((name) => createBook({ name })));

    const positions = (await db.select({ sortOrder: books.sortOrder }).from(books)).map(
      (row) => row.sortOrder
    );
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("refuses a reorder that does not list every active book exactly once", async () => {
    const { firstBookId, secondBookId } = await fixture();

    await expect(reorderBooks([firstBookId])).rejects.toMatchObject({
      code: "BOOK_ORDER_INVALID",
    });
    await expect(reorderBooks([firstBookId, secondBookId, secondBookId])).rejects.toMatchObject({
      code: "BOOK_ORDER_INVALID",
    });
  });

  it("archives a book that holds records, even the former 总账 default", async () => {
    const { db, firstBookId } = await fixture();
    const holding = await createBook({ name: "哞哞的" });
    const sourceDocumentId = await createTestSourceDocument(db);
    await db
      .update(sourceDocuments)
      .set({ bookId: holding.id })
      .where(eq(sourceDocuments.id, sourceDocumentId));

    // The first book is nothing special any more: 总账 is a view over every
    // book, so any book but the last can be retired.
    expect(await archiveBook(firstBookId)).toMatchObject({
      status: "archived",
    });

    // A book that still holds records is what archiving is for: its records keep
    // counting in 总账 while the book leaves the switcher.
    expect(await listBooks()).toHaveLength(2);
    expect(await listBooks()).not.toContainEqual(expect.objectContaining({ id: firstBookId }));
    // 设置 asks for the archived rows and gets them, with their records intact.
    const withArchived = await listBooks({ includeArchived: true });
    expect(withArchived.find((book) => book.id === firstBookId)?.archivedAt).not.toBeNull();
    // The name is free again once the book is archived.
    const reused = await createBook({ name: "共同支出" });
    expect(reused.id).not.toBe(firstBookId);
    // ...and the retired book can be resolved by id, so the detail page can name it.
    expect((await getBookIncludingArchived(firstBookId))?.name).toBe("共同支出");
  });

  it("refuses to archive the last live book, with the port's own code", async () => {
    const { firstBookId, secondBookId } = await fixture();
    expect(await archiveBook(firstBookId)).toMatchObject({
      status: "archived",
    });
    await expect(archiveBook(secondBookId)).rejects.toMatchObject({
      code: "BOOK_LAST_ACTIVE",
    });
  });

  it("refuses to archive a book that still has an active API key bound to it", async () => {
    const { secondBookId } = await fixture();
    await createServiceCredential({ name: "Bound", bookId: secondBookId });

    expect(await archiveBook(secondBookId)).toEqual({
      status: "has_credentials",
    });
    expect(await getBook(secondBookId)).not.toBeNull();
  });

  it("archives a book whose keys are all revoked, but still refuses to delete it", async () => {
    const { secondBookId } = await fixture();
    const created = await createServiceCredential({
      name: "Revoked",
      bookId: secondBookId,
    });
    await revokeServiceCredential(created.id);

    // A revoked key cannot upload and cannot be rebound, so it must not retire
    // the book forever.
    expect(await archiveBook(secondBookId)).toMatchObject({
      status: "archived",
    });

    // The row still references the book, so the hard delete stays impossible —
    // and the refusal is the "archive it instead" one, not an impossible
    // rebinding ask.
    const restored = await restoreBook(secondBookId);
    expect(restored.archivedAt).toBeNull();
    expect(await deleteBook(secondBookId)).toEqual({
      status: "has_records",
    });
  });

  it("deletes only an empty book with no keys", async () => {
    const { db, secondBookId } = await fixture();

    // An empty, unkeyed book is removable for good.
    const third = await createBook({ name: "第三个" });
    expect(await deleteBook(third.id)).toEqual({ status: "deleted" });
    expect(await getBookIncludingArchived(third.id)).toBeNull();

    // A key is a reason to keep the book: uploads would lose their target.
    await createServiceCredential({ name: "Bound", bookId: secondBookId });
    expect(await deleteBook(secondBookId)).toEqual({
      status: "has_credentials",
    });

    // A record points at the book, so it blocks a delete too.
    const holding = await createBook({
      name: "有记录的",
    });
    const sourceDocumentId = await createTestSourceDocument(db);
    await db
      .update(sourceDocuments)
      .set({ bookId: holding.id })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    expect(await deleteBook(holding.id)).toEqual({
      status: "has_records",
    });
  });

  it("deletes a book once every record it held is deleted", async () => {
    const { db, secondBookId } = await fixture();
    const sourceDocumentId = await createTestSourceDocument(db);
    await db
      .update(sourceDocuments)
      .set({ bookId: secondBookId })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    expect(await deleteBook(secondBookId)).toEqual({ status: "has_records" });

    await deleteSourceDocumentAtomically({ sourceDocumentId });
    expect(await deleteBook(secondBookId)).toEqual({ status: "deleted" });
  });

  it("refuses to delete the last live book, with the port's own code", async () => {
    const { firstBookId, secondBookId } = await fixture();
    await archiveBook(firstBookId);
    await expect(deleteBook(secondBookId)).rejects.toMatchObject({
      code: "BOOK_LAST_ACTIVE",
    });
  });

  it("restores an archived book and refuses a name that is taken by then", async () => {
    const { secondBookId } = await fixture();
    expect(await archiveBook(secondBookId)).toMatchObject({
      status: "archived",
    });

    // While it is retired another book takes its name, so restoring collides.
    await createBook({ name: "梁梁的" });
    await expect(restoreBook(secondBookId)).rejects.toMatchObject({
      code: "BOOK_NAME_TAKEN",
    });

    // Renaming the live book frees the name, and the restore then works.
    const live = (await listBooks()).find((book) => book.name === "梁梁的")!;
    await updateBook(live.id, { name: "别的" });
    const restored = await restoreBook(secondBookId);
    expect(restored.archivedAt).toBeNull();
    expect((await listBooks()).map((book) => book.id)).toContain(secondBookId);
  });

  it("refuses a name another live book already uses", async () => {
    await fixture();

    await expect(createBook({ name: "共同支出" })).rejects.toMatchObject({
      code: "BOOK_NAME_TAKEN",
    });
  });

  it("binds a service credential to a book and follows it to another", async () => {
    const { firstBookId, secondBookId } = await fixture();
    const created = await createServiceCredential({
      name: "Automation",
      bookId: firstBookId,
    });

    const authenticated = await authenticateServiceCredential(created.token);
    expect(authenticated).toMatchObject({ id: created.id, bookId: firstBookId });

    const moved = await setServiceCredentialBook(created.id, secondBookId);
    expect(moved?.bookId).toBe(secondBookId);
    expect(await authenticateServiceCredential(created.token)).toMatchObject({
      bookId: secondBookId,
    });
  });

  it("stops authenticating a key whose book is archived, and resumes on restore", async () => {
    const { db, secondBookId } = await fixture();
    const created = await createServiceCredential({
      name: "Book-bound",
      bookId: secondBookId,
    });
    expect(await authenticateServiceCredential(created.token)).not.toBeNull();

    // The adapter refuses to archive a book that still has a key, so the state is
    // produced directly here: this is the guard against a book that was retired
    // (or restored into) outside the normal path.
    await db.update(books).set({ archivedAt: new Date() }).where(eq(books.id, secondBookId));
    expect(await authenticateServiceCredential(created.token)).toBeNull();
    // The key itself is untouched: the book only stopped accepting uploads.
    const row = await getTestDb()
      .select({ id: serviceCredentials.id })
      .from(serviceCredentials)
      .where(eq(serviceCredentials.id, created.id));
    expect(row).toHaveLength(1);

    // Bringing the book back starts the key working again.
    await restoreBook(secondBookId);
    expect(await authenticateServiceCredential(created.token)).not.toBeNull();
  });
});
