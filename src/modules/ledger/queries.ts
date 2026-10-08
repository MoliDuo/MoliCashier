import { postLedgerQuery, type LedgerQueryOptions } from "@/lib/queries/post-ledger-query";
import type { PeriodQuery } from "./domain/period";
import type { LedgerStatsQueryInput, ListLedgerEntriesInput } from "./contract-schemas";
import type {
  BookDto,
  CategoryAssignmentEntryStatesDto,
  CategoryAssignmentResultPageDto,
  CategoryAssignmentJobDto,
  EntryCategoryWithCountDto,
  LedgerDto,
  LedgerEntryPageDto,
  LedgerSettingsViewDto,
  LedgerSummaryDto,
} from "./contracts";

/**
 * Browser reads of the ledger, served by `/api/ledger-queries`. Each takes the
 * signal React Query hands its query function, so a cancelled query stops its request.
 */
export const fetchLedger = (options?: LedgerQueryOptions) =>
  postLedgerQuery<LedgerDto>("ledger", [], options);

export const fetchLedgerEntries = (
  input: PeriodQuery<ListLedgerEntriesInput>,
  options?: LedgerQueryOptions
) => postLedgerQuery<LedgerEntryPageDto>("entries", [input], options);

export const fetchLedgerSummary = (
  input: PeriodQuery<LedgerStatsQueryInput>,
  options?: LedgerQueryOptions
) => postLedgerQuery<LedgerSummaryDto>("summary", [input], options);

/** The three book reads the switcher, 设置 and the detail page use. */
export const fetchBooks = (options?: LedgerQueryOptions) =>
  postLedgerQuery<BookDto[]>("books", [], options);

export const fetchBooksIncludingArchived = (options?: LedgerQueryOptions) =>
  postLedgerQuery<BookDto[]>("books-including-archived", [], options);

export const fetchBook = (bookId: string, options?: LedgerQueryOptions) =>
  postLedgerQuery<BookDto | null>("book", [bookId], options);

export const fetchEntryCategories = (options?: LedgerQueryOptions) =>
  postLedgerQuery<EntryCategoryWithCountDto[]>("categories", [], options);

export const fetchLedgerSettings = (options?: LedgerQueryOptions) =>
  postLedgerQuery<LedgerSettingsViewDto>("settings", [], options);

export const fetchCategoryAssignmentJob = (options?: LedgerQueryOptions) =>
  postLedgerQuery<CategoryAssignmentJobDto | null>("category-assignment", [], options);

export const fetchCategoryAssignmentResults = (
  input: {
    jobId: string;
    cursor?: number;
    limit?: number;
  },
  options?: LedgerQueryOptions
) =>
  postLedgerQuery<CategoryAssignmentResultPageDto>("category-assignment-results", [input], options);

export const fetchCategoryAssignmentEntryStates = (jobId: string, options?: LedgerQueryOptions) =>
  postLedgerQuery<CategoryAssignmentEntryStatesDto>(
    "category-assignment-entry-states",
    [{ jobId }],
    options
  );
