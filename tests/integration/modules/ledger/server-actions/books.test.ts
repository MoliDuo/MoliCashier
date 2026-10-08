import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { SIGN_IN_PATH } from "@/modules/auth/constants";
import {
  archiveBookAction,
  createBookAction,
  deleteBookAction,
  reorderBooksAction,
  restoreBookAction,
  updateBookAction,
} from "@/modules/ledger/server-actions/books";
import { createServiceCredential } from "@/modules/ledger/server/service-credentials";
import { getTestDb } from "tests/setup";
import { testSession } from "tests/helpers/session";
import { createTestLedger, createTestSourceDocument, testBookId } from "tests/helpers/schema-setup";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

/**
 * The 分账 actions answer every refusal 设置 explains with a stable code; the
 * rules behind them are tested on the server functions (`server/books.test.ts`).
 */
describe("book actions", () => {
  beforeEach(async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(testSession({ email: "books@example.com" }));
    await createTestLedger(getTestDb());
  });

  /** The ledger's first book, which holds the test records, and a second, empty one. */
  async function twoBooks() {
    const firstBookId = await testBookId(getTestDb());
    const created = await createBookAction({ name: "旅行" });
    if (!created.ok || created.book == null) throw new Error("Expected the book to be created");
    return { firstBookId, secondBookId: created.book.id };
  }

  it("creates, renames, reorders and restores, answering with the whole list", async () => {
    const { firstBookId, secondBookId } = await twoBooks();

    await expect(updateBookAction(secondBookId, { name: "出差" })).resolves.toMatchObject({
      ok: true,
      book: { id: secondBookId, name: "出差" },
    });
    await expect(reorderBooksAction([secondBookId, firstBookId])).resolves.toMatchObject({
      ok: true,
      books: [{ id: secondBookId }, { id: firstBookId }],
    });
    await expect(archiveBookAction(secondBookId)).resolves.toMatchObject({
      ok: true,
      books: expect.arrayContaining([
        expect.objectContaining({ id: secondBookId, archivedAt: expect.any(String) }),
      ]),
    });
    await expect(restoreBookAction(secondBookId)).resolves.toMatchObject({
      ok: true,
      book: { id: secondBookId, archivedAt: null },
    });
    await expect(deleteBookAction(secondBookId)).resolves.toMatchObject({
      ok: true,
      books: [{ id: firstBookId }],
    });
  });

  it("names a taken name and an empty one apart", async () => {
    await twoBooks();

    await expect(createBookAction({ name: "旅行" })).resolves.toEqual({
      ok: false,
      code: "name_taken",
    });
    await expect(createBookAction({ name: "   " })).resolves.toEqual({
      ok: false,
      code: "invalid_name",
    });
  });

  it("says a book that is gone is not found", async () => {
    const missing = crypto.randomUUID();

    await expect(updateBookAction(missing, { name: "不存在" })).resolves.toEqual({
      ok: false,
      code: "not_found",
    });
    await expect(archiveBookAction(missing)).resolves.toEqual({ ok: false, code: "not_found" });
    await expect(deleteBookAction(missing)).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("refuses an order that does not list every live book once", async () => {
    const { firstBookId } = await twoBooks();

    await expect(reorderBooksAction([firstBookId])).resolves.toEqual({
      ok: false,
      code: "invalid_order",
    });
  });

  it("keeps a book that holds records or an API key", async () => {
    const { firstBookId, secondBookId } = await twoBooks();
    await createTestSourceDocument(getTestDb());

    await expect(deleteBookAction(firstBookId)).resolves.toEqual({
      ok: false,
      code: "has_records",
    });

    await createServiceCredential({ name: "Uploader", bookId: secondBookId });
    await expect(archiveBookAction(secondBookId)).resolves.toEqual({
      ok: false,
      code: "has_credentials",
    });
    await expect(deleteBookAction(secondBookId)).resolves.toEqual({
      ok: false,
      code: "has_credentials",
    });
  });

  it("keeps the last live book", async () => {
    const onlyBookId = await testBookId(getTestDb());

    await expect(archiveBookAction(onlyBookId)).resolves.toEqual({
      ok: false,
      code: "last_book",
    });
  });

  it("sends a signed-out session to sign in instead of answering", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    await expect(createBookAction({ name: "旅行" })).rejects.toMatchObject({
      digest: expect.stringContaining(SIGN_IN_PATH),
    });
  });
});
