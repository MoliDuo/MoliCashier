import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  QueryClient,
  dehydrate,
  type DehydratedState,
  type InfiniteData,
} from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER, QUERY } from "@/lib/constants";
import { listCategoriesWithCount } from "@/modules/ledger/server/categories";
import { listBooks } from "@/modules/ledger/server/books";
import { getLatestCategoryAssignmentJobDto } from "@/modules/ledger/server/get-category-assignment-job";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { DEFAULT_PERIOD, type Period } from "@/modules/ledger/domain/period";
import type { StreamPage } from "@/modules/source-document/contracts";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";
import {
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";

import type {
  BookDto,
  CategoryAssignmentJobDto,
  EntryCategoryWithCountDto,
  LedgerDto,
  LedgerEntryPageDto,
} from "@/modules/ledger/contracts";
import { BOOK_SCOPE_COOKIE, parseBookScopeCookie } from "@/lib/book-scope-cookie";
import {
  resolveAuthenticatedHome,
  type AuthenticatedHomeContext,
} from "./resolve-authenticated-home";
import { runLedgerQuery, type LedgerQueryContext } from "./ledger-queries";

export interface LedgerViewScope {
  /**
   * The book the page is narrowed to after the live-list check, null for 总账.
   * The remembered scope can name a book that has since been archived or
   * deleted; the live list is the authority, and the server must not prefetch
   * the dead book's records.
   */
  bookId: string | null;
}

/**
 * The book a page is read in: the one this device remembered, while it is
 * still live. Without the live list the remembered book cannot be checked, so
 * the page keeps it — losing it would quietly reset the reader to 总账.
 */
export function resolveLedgerViewScope(input: {
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  rememberedBookId: string | null;
}): LedgerViewScope {
  if (input.books == null) return { bookId: input.rememberedBookId };
  const live =
    input.rememberedBookId != null &&
    input.books.some((book) => book.id === input.rememberedBookId);
  return { bookId: live ? input.rememberedBookId : null };
}

export interface LedgerView extends LedgerViewScope {
  context: AuthenticatedHomeContext;
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  /** The book this device's cookie names, before the live-list check. */
  rememberedBookId: string | null;
  /** Today in the ledger's zone, so the first render and the prefetch agree. */
  ledgerToday: string;
  /**
   * The categories read, started alongside the books rather than after them.
   * The shell's bootstrap awaits it and handles its failure.
   */
  categories: Promise<EntryCategoryWithCountDto[]>;
  /**
   * The ledger's latest assignment run, or null when it has had none; started
   * with the categories and awaited by the shell's bootstrap, which drops it on
   * failure.
   */
  categoryAssignmentJob: Promise<CategoryAssignmentJobDto | null>;
}

/**
 * What every ledger route is rendered against: the session's ledger, its live
 * books, the book this device reads it in, and the ledger's today. Cached per
 * request, so the layout and the page share one read.
 */
export const loadLedgerView = cache(async (): Promise<LedgerView> => {
  const context = await resolveAuthenticatedHome();
  const cookieStore = await cookies();
  const rememberedBookId = parseBookScopeCookie(cookieStore.get(BOOK_SCOPE_COOKIE)?.value ?? null);
  const categories = listCategoriesWithCount();
  categories.catch(() => {});
  const categoryAssignmentJob = getLatestCategoryAssignmentJobDto();
  categoryAssignmentJob.catch(() => {});
  let books: readonly BookDto[] | null;
  try {
    books = await listBooks();
  } catch (error) {
    logger.error({ error }, "Ledger books failed to load; falling back to client queries");
    books = null;
  }
  return {
    context,
    books,
    rememberedBookId,
    ledgerToday: ledgerToday(context.ledgerDto.settings.timeZone),
    categories,
    categoryAssignmentJob,
    ...resolveLedgerViewScope({ books, rememberedBookId }),
  };
});

/**
 * The live books, for the top bar's book switcher. The bars render outside the
 * layout's data Suspense and read the books first, so the books are hydrated
 * above them: hydrated any later, they land on a query the switcher already
 * started, which defers them to an effect, and the workspace's context changes
 * under a page that may still be streaming in.
 */
export function getLedgerBooksBootstrap(books: readonly BookDto[] | null): DehydratedState {
  const queryClient = new QueryClient();
  if (books != null) queryClient.setQueryData(queryKeys.books(), books);
  return dehydrate(queryClient);
}

/**
 * The ledger, its categories and its latest assignment run: what the workspace
 * inside the layout renders from. The run is read above the page for the same
 * reason as the books: read later, a run that is moving would change the
 * workspace's context under a page still streaming in. Without it the client
 * reads the run itself, as it does anyway to drive recovery.
 */
export async function getLedgerShellBootstrap(input: {
  ledgerDto: LedgerDto;
  categories: Promise<EntryCategoryWithCountDto[]>;
  categoryAssignmentJob: Promise<CategoryAssignmentJobDto | null>;
}): Promise<DehydratedState> {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.ledger(), input.ledgerDto);
  queryClient.setQueryData(queryKeys.entryCategories(), await input.categories);
  try {
    queryClient.setQueryData(queryKeys.categoryAssignment(), await input.categoryAssignmentJob);
  } catch (error) {
    logger.error(
      { error },
      "Category assignment run failed to load; falling back to the client read"
    );
  }
  return dehydrate(queryClient);
}

export interface GetLedgerRouteBootstrapInput {
  page: LedgerTab;
  ledgerDto: LedgerDto;
  scope: LedgerViewScope;
  period?: Period;
  advancedFilters?: LedgerAdvancedFilters;
}

/**
 * The first screen of one route, so its HTML arrives filled rather than as a
 * skeleton. The keys name the period and the reads run through the same query
 * registry as the browser's own reads, so the cache it fills is the one the tab
 * mounts. The page has already authenticated and loaded the ledger.
 */
export async function getLedgerRouteBootstrap(
  input: GetLedgerRouteBootstrapInput
): Promise<DehydratedState> {
  const { mainCurrency } = input.ledgerDto.settings;
  const context: LedgerQueryContext = { ledger: input.ledgerDto };
  const { bookId } = input.scope;
  const period = input.period ?? DEFAULT_PERIOD;
  const queryClient = new QueryClient();

  if (input.page === "settings") {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.ledgerSettings(),
      queryFn: () => runLedgerQuery("settings", undefined, context),
      staleTime: LEDGER.STALE_TIME_MS,
    });
    return dehydrate(queryClient);
  }

  if (input.page === "records") {
    const descriptor = buildStreamQueryDescriptor({
      ...(bookId == null ? {} : { bookId }),
      period,
      minAmount: input.advancedFilters?.minAmount,
      maxAmount: input.advancedFilters?.maxAmount,
      statuses: input.advancedFilters?.statuses,
      search: input.advancedFilters?.search,
      categoryId: input.advancedFilters?.categoryId,
      currency: input.advancedFilters?.currency,
    });
    await Promise.all([
      queryClient.prefetchInfiniteQuery({
        queryKey: descriptor.queryKey,
        queryFn: async ({ pageParam }) => {
          const pageInput = descriptor.getPageInput(pageParam as string | undefined);
          let page = await runLedgerQuery("stream", pageInput, context);
          if (pageParam == null && page.restartRequired) {
            page = await runLedgerQuery("stream", pageInput, context);
            if (page.restartRequired) {
              throw new Error("Stream restart did not produce a valid first page");
            }
          }
          return page;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: StreamPage) => lastPage.nextCursor,
        staleTime: QUERY.SOURCE_DOC_STALE_TIME_MS,
      }),
      queryClient.prefetchQuery({
        queryKey: descriptor.totalQueryKey,
        queryFn: () => runLedgerQuery("total", descriptor.totalInput, context),
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
    ]);
    const stream = queryClient.getQueryData<InfiniteData<StreamPage>>(descriptor.queryKey);
    const firstPage = stream?.pages[0];
    if (firstPage != null && !firstPage.restartRequired) {
      queryClient.setQueryData(queryKeys.ledgerSync(), {
        version: firstPage.generation,
        changed: false,
        hasTransitionalWork: firstPage.hasTransitionalWork,
      });
    }
    return dehydrate(queryClient);
  }

  if (input.page === "entries") {
    const descriptor = buildDetailsQueryDescriptor({
      ...(bookId == null ? {} : { bookId }),
      period,
      ...(input.advancedFilters !== undefined ? { advancedFilters: input.advancedFilters } : {}),
      mainCurrency,
    });
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: descriptor.summaryQueryKey,
        queryFn: () => runLedgerQuery("summary", descriptor.summaryInput, context),
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
      queryClient.prefetchInfiniteQuery({
        queryKey: descriptor.entriesQueryKey,
        queryFn: ({ pageParam }) =>
          runLedgerQuery(
            "entries",
            descriptor.getEntriesInput(pageParam as string | undefined),
            context
          ),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: LedgerEntryPageDto) => lastPage.nextCursor,
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
    ]);
    return dehydrate(queryClient);
  }

  const descriptor = buildStatsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    period,
    mainCurrency,
  });
  await queryClient.prefetchQuery({
    queryKey: descriptor.queryKey,
    queryFn: () => runLedgerQuery("stats", descriptor.input, context),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  return dehydrate(queryClient);
}
