import {
  canonicalizeSourceDocumentProcessingStatuses,
  type SourceDocumentProcessingStatus,
} from "@/modules/source-document/types";
import type { GetStreamTotalInput, ListStreamPageInput } from "@/modules/source-document/contracts";
import { periodKey, type Period, type PeriodQuery } from "@/modules/ledger/domain/period";
import { normalizeSearchTerm } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";

const STREAM_PAGE_LIMIT = 20;

export { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";

export interface StreamQueryDescriptor {
  queryKey: readonly unknown[];
  totalQueryKey: readonly unknown[];
  filterSignature: string;
  getPageInput: (pageParam?: string) => PeriodQuery<ListStreamPageInput>;
  totalInput: PeriodQuery<GetStreamTotalInput>;
}

export function buildStreamQueryDescriptor(input: {
  bookId?: string;
  period: Period;
  minAmount?: string | null | undefined;
  maxAmount?: string | null | undefined;
  statuses?: readonly SourceDocumentProcessingStatus[] | null | undefined;
  search?: string | null | undefined;
  /** A category id, or the uncategorized sentinel. */
  categoryId?: string | null | undefined;
  currency?: string | null | undefined;
}): StreamQueryDescriptor {
  const canonicalStatuses = canonicalizeSourceDocumentProcessingStatuses(
    input.statuses == null ? undefined : [...input.statuses]
  );
  const statusesKey = canonicalStatuses?.join(",") ?? null;
  const search = normalizeSearchTerm(input.search) ?? null;
  const baseInput = {
    ...(input.bookId == null ? {} : { bookId: input.bookId }),
    period: input.period,
    ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
    ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
    ...(canonicalStatuses != null ? { statuses: canonicalStatuses } : {}),
    ...(search != null ? { search } : {}),
    ...(input.categoryId != null ? { categoryId: input.categoryId } : {}),
    ...(input.currency != null ? { currency: input.currency } : {}),
  };
  const keyFilters = {
    bookId: input.bookId ?? null,
    period: periodKey(input.period),
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    statuses: statusesKey,
    search,
    categoryId: input.categoryId ?? null,
    currency: input.currency ?? null,
  };

  return {
    queryKey: queryKeys.sourceDocumentStream(keyFilters),
    totalQueryKey: queryKeys.sourceDocumentStreamTotal(keyFilters),
    filterSignature: JSON.stringify(keyFilters),
    getPageInput: (pageParam) => ({
      ...baseInput,
      ...(pageParam != null ? { cursor: pageParam } : {}),
      limit: STREAM_PAGE_LIMIT,
    }),
    totalInput: baseInput,
  };
}

/** 统计's read: a book and a period, whose days and comparison the server resolves. */
export interface StatsQueryInput {
  bookId?: string;
  period: Period;
}

export interface StatsQueryDescriptor {
  queryKey: readonly unknown[];
  /** The forecast shown beside the same statistics, read with the same input. */
  forecastQueryKey: readonly unknown[];
  input: StatsQueryInput;
}

export function buildStatsQueryDescriptor(input: {
  bookId?: string;
  period: Period;
  mainCurrency: string;
}): StatsQueryDescriptor {
  const keyParams = {
    bookId: input.bookId ?? null,
    period: periodKey(input.period),
    mainCurrency: input.mainCurrency,
  };
  return {
    queryKey: queryKeys.enhancedStats(keyParams),
    forecastQueryKey: queryKeys.forecast(keyParams),
    input: {
      ...(input.bookId == null ? {} : { bookId: input.bookId }),
      period: input.period,
    },
  };
}
