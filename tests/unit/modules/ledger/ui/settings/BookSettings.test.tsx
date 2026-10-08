import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerQueryErrorCopy } from "@/copy/app";
import { settingsBooksCopy } from "@/copy/settings";
import { queryKeys } from "@/lib/query-keys";
import type { BookDto } from "@/modules/ledger/contracts";

const {
  getBooksAction,
  getBooksIncludingArchivedAction,
  updateBookAction,
  archiveBookAction,
  toastError,
  toastSuccess,
} = vi.hoisted(() => ({
  getBooksAction: vi.fn(),
  getBooksIncludingArchivedAction: vi.fn(),
  updateBookAction: vi.fn(),
  archiveBookAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/modules/ledger/queries", () => ({
  fetchBooks: getBooksAction,
  fetchBooksIncludingArchived: getBooksIncludingArchivedAction,
}));

vi.mock("@/modules/ledger/server-actions/books", () => ({
  createBookAction: vi.fn(),
  updateBookAction,
  reorderBooksAction: vi.fn(),
  archiveBookAction,
  restoreBookAction: vi.fn(),
  deleteBookAction: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

import { BookSettings } from "@/modules/ledger/ui/settings/BookSettings";

const LIVE: BookDto = {
  id: "book-1",
  name: "共同支出",
  sortOrder: 1,
  archivedAt: null,
};
const RENAME_LIVE = settingsBooksCopy.rename({ name: LIVE.name });
const ARCHIVED: BookDto = {
  id: "book-2",
  name: "旧旅行账本",
  sortOrder: 2,
  archivedAt: "2026-02-01T00:00:00.000Z",
};

function renderBookSettings(props: { initialBooks?: readonly BookDto[] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(<BookSettings {...props} />, { wrapper });
  return { ...view, queryClient };
}

describe("设置 book list data range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the archived-inclusive list when 设置 was opened without one", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings();

    // The workspace hands in the live books only, so the archived rows are
    // invisible until this query runs; seeding it with the live list would keep
    // the retired book hidden for the whole stale window.
    expect(await screen.findByText(ARCHIVED.name)).toBeInTheDocument();
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();
    expect(getBooksIncludingArchivedAction).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(getBooksAction).not.toHaveBeenCalled();
  });

  it("reuses a complete bootstrap list without asking again", () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    expect(screen.getByText(ARCHIVED.name)).toBeInTheDocument();
    expect(getBooksIncludingArchivedAction).not.toHaveBeenCalled();
  });

  it("shows a loading placeholder instead of the empty state while the list is in flight", () => {
    getBooksIncludingArchivedAction.mockReturnValue(new Promise(() => {}));
    renderBookSettings();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(settingsBooksCopy.empty)).not.toBeInTheDocument();
  });

  it("offers the empty state only once the list has really arrived empty", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([]);
    renderBookSettings();

    expect(await screen.findByText(settingsBooksCopy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("reports a first-load failure and refetches on retry", async () => {
    getBooksIncludingArchivedAction.mockRejectedValueOnce(new Error("offline"));
    renderBookSettings();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(settingsBooksCopy.empty)).not.toBeInTheDocument();

    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    fireEvent.click(screen.getByRole("button", { name: ledgerQueryErrorCopy.retry }));

    expect(await screen.findByText(ARCHIVED.name)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("renames a book in its own row and writes it without a dialog", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    const renamed = { ...LIVE, name: "日常开销" };
    updateBookAction.mockResolvedValue({ ok: true, books: [renamed, ARCHIVED] });
    const { queryClient } = renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    // A name is one field of a book that already exists, so the row itself opens
    // for editing — nothing may cover the list to change it.
    fireEvent.click(screen.getByRole("button", { name: RENAME_LIVE }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: RENAME_LIVE });
    fireEvent.change(input, { target: { value: "日常开销" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(updateBookAction).toHaveBeenCalledWith(LIVE.id, { name: "日常开销" })
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: RENAME_LIVE })).not.toBeInTheDocument()
    );
    expect(screen.getByText("日常开销")).toBeInTheDocument();
    // The answer carries the whole list: the switcher's live list is written
    // from it too, without the archived row.
    expect(queryClient.getQueryData(queryKeys.booksIncludingArchived())).toEqual([
      renamed,
      ARCHIVED,
    ]);
    expect(setQueryData).toHaveBeenCalledWith(queryKeys.books(), [renamed]);
  });

  it("keeps the row open on a refused name and reports why", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    updateBookAction.mockResolvedValue({ ok: false, code: "name_taken" });
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    fireEvent.click(screen.getByRole("button", { name: RENAME_LIVE }));
    const input = screen.getByRole("textbox", { name: RENAME_LIVE });
    fireEvent.change(input, { target: { value: "旧旅行账本" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(settingsBooksCopy.nameTaken));
    expect(screen.getByRole("textbox", { name: RENAME_LIVE })).toHaveValue("旧旅行账本");
  });

  it("archives a book after confirmation and moves it to the archived list", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    const retired = { ...LIVE, archivedAt: "2026-03-01T00:00:00.000Z" };
    archiveBookAction.mockResolvedValue({ ok: true, books: [retired, ARCHIVED] });
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: settingsBooksCopy.moreActions({ name: LIVE.name }) })
    );
    await user.click(screen.getByRole("menuitem", { name: settingsBooksCopy.archive }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: settingsBooksCopy.archive }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(settingsBooksCopy.archived));
    expect(archiveBookAction).toHaveBeenCalledWith(LIVE.id);
    expect(await screen.findByText(settingsBooksCopy.empty)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: settingsBooksCopy.restore })).toHaveLength(2);
  });

  it("drops the draft on Escape and writes nothing", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    fireEvent.click(screen.getByRole("button", { name: RENAME_LIVE }));
    const input = screen.getByRole("textbox", { name: RENAME_LIVE });
    fireEvent.change(input, { target: { value: "改到一半" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(updateBookAction).not.toHaveBeenCalled();
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: RENAME_LIVE })).not.toBeInTheDocument();
  });

  it("does not write a name that was opened and left unchanged", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });

    fireEvent.click(screen.getByRole("button", { name: RENAME_LIVE }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: RENAME_LIVE }), { key: "Enter" });

    expect(updateBookAction).not.toHaveBeenCalled();
  });

  it("keeps the list and reports a retry when a background refresh fails", async () => {
    getBooksIncludingArchivedAction.mockResolvedValue([LIVE, ARCHIVED]);
    const { queryClient } = renderBookSettings({ initialBooks: [LIVE, ARCHIVED] });
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();

    getBooksIncludingArchivedAction.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.booksIncludingArchived(),
      });
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // The failure is about the refresh, not about the data: what the reader
    // already had must stay on screen, and it must not fall back to "no books".
    expect(screen.getByText(LIVE.name)).toBeInTheDocument();
    expect(screen.getByText(ARCHIVED.name)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(settingsBooksCopy.empty)).not.toBeInTheDocument();
  });
});
