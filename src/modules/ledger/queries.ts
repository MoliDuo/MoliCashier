import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
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

/** Browser reads of the ledger, served by `/api/ledger-queries`. */
export const fetchLedger = () => postLedgerQuery<LedgerDto>("ledger");

export const fetchLedgerEntries = (input: PeriodQuery<ListLedgerEntriesInput>) =>
  postLedgerQuery<LedgerEntryPageDto>("entries", [input]);

export const fetchLedgerSummary = (input: PeriodQuery<LedgerStatsQueryInput>) =>
  postLedgerQuery<LedgerSummaryDto>("summary", [input]);

/** The three book reads the switcher, 设置 and the detail page use. */
export const fetchBooks = () => postLedgerQuery<BookDto[]>("books");

export const fetchBooksIncludingArchived = () =>
  postLedgerQuery<BookDto[]>("books-including-archived");

export const fetchBook = (bookId: string) => postLedgerQuery<BookDto | null>("book", [bookId]);

export const fetchEntryCategories = () =>
  postLedgerQuery<EntryCategoryWithCountDto[]>("categories");

export const fetchLedgerSettings = () => postLedgerQuery<LedgerSettingsViewDto>("settings");

export const fetchCategoryAssignmentJob = () =>
  postLedgerQuery<CategoryAssignmentJobDto | null>("category-assignment");

export const fetchCategoryAssignmentResults = (input: {
  jobId: string;
  cursor?: number;
  limit?: number;
}) => postLedgerQuery<CategoryAssignmentResultPageDto>("category-assignment-results", [input]);

export const fetchCategoryAssignmentEntryStates = (jobId: string) =>
  postLedgerQuery<CategoryAssignmentEntryStatesDto>("category-assignment-entry-states", [
    { jobId },
  ]);
