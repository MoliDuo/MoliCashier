"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Check,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ActionRefusedError, refusalCode } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import {
  archiveBookAction,
  createBookAction,
  deleteBookAction,
  reorderBooksAction,
  restoreBookAction,
  updateBookAction,
  type BookMutationErrorCode,
  type BookMutationResult,
} from "@/modules/ledger/server-actions/books";
import { SettingsField } from "@/components/SettingsField";
import { SettingsSection } from "@/components/SettingsSection";
import type { BookDto } from "@/modules/ledger/contracts";
import { ledgerQueryErrorCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";
import { settingsBooksCopy } from "@/copy/settings";

const BOOK_ERROR_KEYS = {
  name_taken: "nameTaken",
  invalid_name: "invalidName",
  has_records: "hasRecords",
  has_credentials: "hasCredentials",
  last_book: "lastBook",
  not_found: "notFound",
  invalid_order: "saveFailed",
  unexpected: "saveFailed",
} as const satisfies Record<BookMutationErrorCode, string>;

interface BookSettingsProps {
  /**
   * A list that already contains the archived rows. Leaving it undefined means
   * 设置 was opened without one — the workspace switcher only carries the live
   * books — and the complete list is fetched rather than seeded with a partial
   * one, which the archived-inclusive query would then trust for ten minutes.
   */
  initialBooks?: readonly BookDto[] | undefined;
}

/**
 * 分账: reorder, add, rename, archive, restore and delete. The
 * order here is the order of the pull-down switcher, and the archived books are
 * listed apart from the live ones because they are no longer part of it.
 */
export function BookSettings({ initialBooks }: BookSettingsProps) {
  const { books, booksQuery } = useBooks({
    ...(initialBooks !== undefined ? { initialBooks } : {}),
    includeArchived: true,
  });
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<BookDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookDto | null>(null);

  /**
   * Every success carries the whole book list, so the cache is written directly
   * and the switcher, the record pickers and 设置 all move together without
   * waiting for a refetch. The archived-inclusive list seeds both cache entries:
   * the switcher's live list is that list minus the retired rows, so the two
   * views can never disagree about which books exist.
   */
  const writeBooks = (books: BookDto[], successMessage?: string) => {
    queryClient.setQueryData(queryKeys.booksIncludingArchived(), books);
    queryClient.setQueryData(
      queryKeys.books(),
      books.filter((book) => book.archivedAt == null)
    );
    if (successMessage != null) toast.success(successMessage);
  };
  /**
   * A refusal and a failed request both end as a toast. An order the server
   * refused was built from a list that is out of date, so the list reads again.
   */
  const reportFailure = (error: Error) => {
    const code = refusalCode<BookMutationErrorCode>(error);
    toast.error(settingsBooksCopy[BOOK_ERROR_KEYS[code ?? "unexpected"]]);
    if (code === "invalid_order") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.booksIncludingArchived() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.books() });
    }
  };
  const bookMutation = <TInput,>(
    action: (input: TInput) => Promise<BookMutationResult>,
    successMessage?: string
  ) => ({
    mutationFn: async (input: TInput) => {
      const result = await action(input);
      if (!result.ok) throw new ActionRefusedError<BookMutationErrorCode>(result.code);
      return result.books;
    },
    onSuccess: (result: BookDto[]) => writeBooks(result, successMessage),
    onError: reportFailure,
  });
  const createBook = useMutation(
    bookMutation((input: { name: string }) => createBookAction(input))
  );
  const updateBook = useMutation(
    bookMutation((input: { bookId: string; name: string }) =>
      updateBookAction(input.bookId, { name: input.name })
    )
  );
  const reorderBooks = useMutation(
    bookMutation((bookIds: string[]) => reorderBooksAction(bookIds))
  );
  const archiveBook = useMutation(
    bookMutation((bookId: string) => archiveBookAction(bookId), settingsBooksCopy.archived)
  );
  const restoreBook = useMutation(
    bookMutation((bookId: string) => restoreBookAction(bookId), settingsBooksCopy.restored)
  );
  const deleteBook = useMutation(
    bookMutation((bookId: string) => deleteBookAction(bookId), settingsBooksCopy.deleted)
  );

  const all = books ?? [];
  const list = all.filter((book) => book.archivedAt == null);
  const archived = all.filter((book) => book.archivedAt != null);
  // Three distinct states, and none of them may be mistaken for "no books":
  // nothing has arrived yet, nothing arrived and the request failed, or the
  // list is showing while a background refresh failed.
  const isLoadingBooks = books === undefined && booksQuery.isPending;
  const booksLoadFailed = books === undefined && booksQuery.isLoadingError;
  const booksRefreshFailed = books !== undefined && booksQuery.isRefetchError;
  const retryBooks = () => void booksQuery.refetch();
  const busy =
    createBook.isPending ||
    updateBook.isPending ||
    reorderBooks.isPending ||
    archiveBook.isPending ||
    restoreBook.isPending ||
    deleteBook.isPending;

  const move = (index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    reorderBooks.mutate(next.map((book) => book.id));
  };

  const startRename = (book: BookDto) => {
    setRenamingId(book.id);
    setRenameDraft(book.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  /**
   * A name is one field of a book that already exists, so it is written the
   * moment it is committed, the way the order above already is.
   * A refusal — a taken name, a name the server trims to nothing — is a toast
   * from the mutation, and the row stays open on the rejected draft so it can
   * be corrected instead of retyped.
   */
  const commitRename = (book: BookDto) => {
    const name = renameDraft.trim();
    if (name === "" || name === book.name) {
      cancelRename();
      return;
    }
    updateBook.mutate({ bookId: book.id, name }, { onSuccess: cancelRename });
  };

  return (
    <SettingsSection
      actions={
        <Button
          type="button"
          size="sm"
          className="max-md:h-11"
          disabled={busy}
          onClick={() => {
            setNewName("");
            setIsAddOpen(true);
          }}
        >
          {settingsBooksCopy.add}
        </Button>
      }
    >
      <div className="space-y-2">
        {booksRefreshFailed ? (
          <div
            role="alert"
            className={textRoleClassName(
              "body",
              "flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2"
            )}
          >
            <span>{ledgerQueryErrorCopy.description}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-11"
              onClick={retryBooks}
            >
              <RefreshCw className="size-4" />
              {ledgerQueryErrorCopy.retry}
            </Button>
          </div>
        ) : null}
        {booksLoadFailed ? (
          <div
            role="alert"
            className={textRoleClassName(
              "body",
              "flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2"
            )}
          >
            <span>{ledgerQueryErrorCopy.description}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-11"
              onClick={retryBooks}
            >
              <RefreshCw className="size-4" />
              {ledgerQueryErrorCopy.retry}
            </Button>
          </div>
        ) : isLoadingBooks ? (
          <ul
            role="status"
            aria-label={commonCopy.loading}
            className="divide-y divide-border rounded-[var(--radius)] border border-border"
          >
            {[0, 1].map((row) => (
              <li key={row} className="p-3">
                <span className="block h-4 w-24 animate-pulse rounded-sm bg-surface2" />
              </li>
            ))}
          </ul>
        ) : list.length === 0 ? (
          <p className={textRoleClassName("bodyMuted")}>{settingsBooksCopy.empty}</p>
        ) : (
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {list.map((book, index) => {
              const renaming = renamingId === book.id;
              return (
                <li key={book.id} className="flex flex-wrap items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <Input
                        autoFocus
                        value={renameDraft}
                        maxLength={20}
                        autoComplete="off"
                        aria-label={settingsBooksCopy.rename({ name: book.name })}
                        disabled={updateBook.isPending}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename(book);
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="h-9 max-md:h-11"
                      />
                    ) : (
                      <span className={textRoleClassName("bodyStrong", "block truncate")}>
                        {book.name}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {renaming ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="max-md:size-11"
                          disabled={renameDraft.trim() === "" || updateBook.isPending}
                          aria-label={commonCopy.save}
                          title={commonCopy.save}
                          onClick={() => commitRename(book)}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="max-md:size-11"
                          disabled={updateBook.isPending}
                          aria-label={commonCopy.cancel}
                          title={commonCopy.cancel}
                          onClick={cancelRename}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="max-md:size-11"
                          disabled={busy}
                          aria-label={settingsBooksCopy.rename({ name: book.name })}
                          title={settingsBooksCopy.rename({ name: book.name })}
                          onClick={() => startRename(book)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {/* Renaming stays on the row; the rarer moves and the
                            two ways to retire a book share one menu. */}
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="max-md:size-11"
                              disabled={busy}
                              aria-label={settingsBooksCopy.moreActions({ name: book.name })}
                              title={settingsBooksCopy.moreActions({ name: book.name })}
                            >
                              <MoreVertical className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem
                              className="max-md:min-h-11"
                              disabled={index === 0}
                              onSelect={() => move(index, -1)}
                            >
                              <ArrowUp className="mr-2 size-4" />
                              {settingsBooksCopy.moveUpShort}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="max-md:min-h-11"
                              disabled={index === list.length - 1}
                              onSelect={() => move(index, 1)}
                            >
                              <ArrowDown className="mr-2 size-4" />
                              {settingsBooksCopy.moveDownShort}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="max-md:min-h-11"
                              onSelect={() => setArchiveTarget(book)}
                            >
                              <Archive className="mr-2 size-4" />
                              {settingsBooksCopy.archive}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-danger focus:text-danger max-md:min-h-11"
                              onSelect={() => setDeleteTarget(book)}
                            >
                              <Trash2 className="mr-2 size-4" />
                              {settingsBooksCopy.delete}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {archived.length > 0 ? (
        <SettingsField title={settingsBooksCopy.archivedSection} stacked>
          <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {archived.map((book) => (
              <li key={book.id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={textRoleClassName("bodyMuted", "truncate font-medium")}>
                      {book.name}
                    </span>
                    <span className="shrink-0 rounded-sm border border-border bg-surface2 px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
                      {settingsBooksCopy.archivedBadge}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="max-md:h-11"
                  disabled={busy}
                  onClick={() => restoreBook.mutate(book.id)}
                >
                  <ArchiveRestore className="mr-1 size-4" />
                  {settingsBooksCopy.restore}
                </Button>
              </li>
            ))}
          </ul>
        </SettingsField>
      ) : null}

      <Dialog open={isAddOpen} onOpenChange={(open) => !createBook.isPending && setIsAddOpen(open)}>
        <DialogContent variant="sheet">
          <DialogHeader>
            <DialogTitle>{settingsBooksCopy.addTitle}</DialogTitle>
            <DialogDescription>{settingsBooksCopy.addDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="new-book-name">{settingsBooksCopy.name}</Label>
            <Input
              id="new-book-name"
              value={newName}
              maxLength={20}
              autoComplete="off"
              placeholder={settingsBooksCopy.namePlaceholder}
              className="max-md:h-11"
              disabled={createBook.isPending}
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              disabled={createBook.isPending}
            >
              {commonCopy.cancel}
            </Button>
            <Button
              disabled={newName.trim() === "" || createBook.isPending}
              onClick={() =>
                createBook.mutate(
                  { name: newName.trim() },
                  { onSuccess: () => setIsAddOpen(false) }
                )
              }
            >
              {settingsBooksCopy.add}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget != null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={settingsBooksCopy.archiveTitle({ name: archiveTarget?.name ?? "" })}
        description={settingsBooksCopy.archiveDesc}
        confirmLabel={settingsBooksCopy.archive}
        variant="destructive"
        onConfirm={() => {
          if (archiveTarget == null) return false;
          archiveBook.mutate(archiveTarget.id);
          setArchiveTarget(null);
          return true;
        }}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={settingsBooksCopy.deleteTitle({ name: deleteTarget?.name ?? "" })}
        description={settingsBooksCopy.deleteDesc}
        confirmLabel={settingsBooksCopy.delete}
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget == null) return false;
          deleteBook.mutate(deleteTarget.id);
          setDeleteTarget(null);
          return true;
        }}
      />
    </SettingsSection>
  );
}
