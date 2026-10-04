/**
 * Centralized Query Key Factory
 *
 * All React Query keys should be defined here to ensure consistency
 * between data fetching and ledger-scoped cache invalidation.
 *
 * Usage:
 *   import { queryKeys } from '@/lib/query-keys';
 *   useQuery({ queryKey: queryKeys.ledgerEntries({ status: 'pending' }), ... })
 */

export const queryKeys = {
  // === Ledger ===
  ledger: () => ["ledger"] as const,
  /**
   * The ledger's sync version. Deliberately outside the ["ledger"] prefix: a
   * version change invalidates every ledger query, and must not invalidate
   * the query that reported it.
   */
  ledgerSync: () => ["ledger-sync"] as const,

  // === Ledger Entries ===
  ledgerEntries: (params?: QueryKeyParams | null) =>
    ["ledger", "entries", normalizeQueryParams(params)] as const,
  ledgerEntriesPrefix: () => ["ledger", "entries"] as const,

  // === Books ===
  /** The switcher's books, so a rename or reorder shows without a fresh page. */
  books: () => ["ledger", "books"] as const,
  /**
   * The same list plus the archived rows. 设置 and the detail page need them,
   * the switcher must not see them, so they are a separate cache entry.
   */
  booksIncludingArchived: () => ["ledger", "books", "including-archived"] as const,
  /** One book by id; the detail page uses it to name a retired book. */
  book: (bookId: string) => ["ledger", "book", bookId] as const,

  // === Source Documents ===
  sourceDocumentStream: (filters?: StreamKeyFilters) =>
    ["ledger", "source-documents", "stream", normalizeQueryParams(filters)] as const,
  sourceDocumentStreamPrefix: () => ["ledger", "source-documents", "stream"] as const,
  sourceDocumentStreamTotal: (filters?: StreamKeyFilters) =>
    ["ledger", "source-documents", "stream-total", normalizeQueryParams(filters)] as const,
  sourceDocumentStreamTotalPrefix: () => ["ledger", "source-documents", "stream-total"] as const,
  sourceDocument: (documentId: string) =>
    ["ledger", "source-document", documentId, "detail"] as const,
  sourceDocumentDetailPrefix: () => ["ledger", "source-document"] as const,
  sourceDocumentInput: (id: string) => ["ledger", "source-document", id, "input"] as const,

  // === Categories ===
  entryCategories: () => ["ledger", "categories"] as const,
  categoryAssignment: () => ["ledger", "category-assignment"] as const,
  categoryAssignmentResults: (jobId: string) =>
    ["ledger", "category-assignment", jobId, "results"] as const,
  /** `progress` is whatever the run's status poll last said, so a change refetches. */
  categoryAssignmentEntryStates: (jobId: string, progress: string) =>
    ["ledger", "category-assignment", jobId, "entry-states", progress] as const,
  ledgerSettings: () => ["ledger", "settings"] as const,

  // === Summary & Stats ===
  summary: (params?: QueryKeyParams | null) =>
    ["ledger", "summary", normalizeQueryParams(params)] as const,
  summaryPrefix: () => ["ledger", "summary"] as const,
  enhancedStats: (params?: {
    bookId?: string | null | undefined;
    /** The period's key: its days are resolved by the server, not named here. */
    period?: string | null | undefined;
    mainCurrency?: string | null | undefined;
  }) => ["ledger", "enhanced-stats", normalizeQueryParams(params)] as const,
  enhancedStatsPrefix: () => ["ledger", "enhanced-stats"] as const,
  /** 统计's forecast, keyed like the statistics it is shown beside. */
  forecast: (params?: {
    bookId?: string | null | undefined;
    period?: string | null | undefined;
    mainCurrency?: string | null | undefined;
  }) => ["ledger", "forecast", normalizeQueryParams(params)] as const,

  // === Currency ===
  convert: (amount: string, from: string, to: string, date: string) =>
    ["ledger", "convert", amount, from, to, date] as const,
} as const;

type QueryKeyParams = Readonly<Record<string, unknown>>;

type StreamKeyFilters = {
  bookId?: string | null | undefined;
  /** The period's key: its days are resolved by the server, not named here. */
  period?: string | null | undefined;
  categoryId?: string | null | undefined;
  currency?: string | null | undefined;
  minAmount?: string | null | undefined;
  maxAmount?: string | null | undefined;
  statuses?: string | null | undefined;
  search?: string | null | undefined;
};

function normalizeQueryParams(params?: QueryKeyParams | null): Readonly<Record<string, unknown>> {
  if (params == null) return {};
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value])
  );
}
