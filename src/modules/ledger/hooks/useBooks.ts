"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { fetchBooks, fetchBooksIncludingArchived } from "@/modules/ledger/queries";
import type { BookDto } from "@/modules/ledger/contracts";

interface UseBooksOptions {
  /** Hydrated from the page bootstrap, so the switcher paints on the first frame. */
  initialBooks?: readonly BookDto[];
  /** 设置 and the detail page need the archived rows; the switcher must not. */
  includeArchived?: boolean;
}

/**
 * The ledger's books, in switcher order. The switcher, the record pickers and
 * the 设置 list all read this one query, so a rename or reorder made in 设置 shows
 * everywhere without a reload and a cached page cannot keep showing a stale name.
 *
 * `includeArchived` reads a separate cache entry rather than filtering the
 * switcher's list: a retired book must never appear in the switcher, not even
 * between a fetch and a render.
 */
export function useBooks({ initialBooks, includeArchived }: UseBooksOptions) {
  const booksQuery = useQuery({
    queryKey: includeArchived ? queryKeys.booksIncludingArchived() : queryKeys.books(),
    queryFn: ({ signal }) =>
      includeArchived ? fetchBooksIncludingArchived({ signal }) : fetchBooks({ signal }),
    staleTime: LEDGER.STALE_TIME_MS,
    ...(initialBooks !== undefined ? { initialData: [...initialBooks] } : {}),
  });
  const books = booksQuery.data;
  return {
    books,
    booksQuery,
  };
}
