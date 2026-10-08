import type { z } from "zod";
import type { splitSourceDocumentInputSchema } from "./contract-schemas";

import type { SourceDocumentProcessingStatus } from "./types";

export type { SourceDocumentProcessingStatus };
export type {
  DuplicateSuggestionDto,
  PendingSuggestionKind,
  SourceDocumentActiveResultSummary,
  SourceDocumentDetailDto,
  SourceDocumentInputDto,
  SourceDocumentListItemDto,
  SourceDocumentStoredFileDto,
  StreamPage,
  StreamTotalDto,
} from "./document-contracts";

export interface CreateSourceDocumentResponseDto {
  sourceDocumentId: string;
  version: 1;
  status: "processing";
}

/**
 * Transaction semantics: one transaction per document, not one for the whole
 * batch. Entries belonging to the same document either all succeed or all
 * roll back together (that document lands in exactly one of `succeeded` or
 * `failed`), but different documents commit independently — one document's
 * failure never blocks or rolls back another's.
 */
export interface PartialBatchCommandResult<TId extends string = string> {
  succeeded: Array<{ id: TId; sourceDocumentId: string }>;
  failed: Array<{ id: TId; code: string }>;
}

export interface RetrySourceDocumentResponseDto {
  status: "processing";
}

export interface CreatedRecordResult {
  sourceDocumentId: string;
  documentDate: string;
}

export type SplitSourceDocumentInput = z.infer<typeof splitSourceDocumentInputSchema>;

export type ApplyDateOrganizationInput = z.infer<
  typeof import("./contract-schemas").applyDateOrganizationInputSchema
>;
export type DismissDateOrganizationInput = z.infer<
  typeof import("./contract-schemas").dismissDateOrganizationInputSchema
>;

export type ApplyDuplicateSuggestionInput = z.infer<
  typeof import("./contract-schemas").applyDuplicateSuggestionInputSchema
>;
export type DismissDuplicateSuggestionInput = z.infer<
  typeof import("./contract-schemas").dismissDuplicateSuggestionInputSchema
>;

export interface ApplyDuplicateSuggestionResultDto {
  removedCount: number;
  /** The record held only flagged entries, so it was deleted. */
  deleted: boolean;
  sourceDocument: import("./document-contracts").SourceDocumentDetailDto | null;
}

export interface ApplyDateOrganizationResultDto {
  sourceDocument: import("./document-contracts").SourceDocumentDetailDto;
  createdSourceDocumentIds: string[];
}

export interface SplitSourceDocumentResultDto {
  sourceDocument: import("./document-contracts").SourceDocumentDetailDto;
  splitSourceDocumentId: string;
  splitVersion: 1;
  movedEntryCount: number;
}

export interface BatchUpdateSourceDocumentsResultDto {
  sourceDocumentIds: string[];
  updatedCount: number;
}

export interface DeleteSourceDocumentResultDto {
  sourceDocumentId: string;
  deleted: boolean;
}

export interface CancelProcessingResponseDto {
  processingStatus: "cancelled";
}

export interface ListStreamPageInput {
  bookId?: string;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  minAmount?: string;
  maxAmount?: string;
  statuses?: string[];
  search?: string;
  /** A category id, or the uncategorized sentinel. */
  categoryId?: string;
  currency?: string;
  cursor?: string | null | undefined;
  limit: number;
}

export interface GetStreamTotalInput {
  bookId?: string;
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  search?: string;
  /** A category id, or the uncategorized sentinel. */
  categoryId?: string;
  currency?: string;
}

export interface CredentialSourceDocumentStatusResult {
  sourceDocumentId: string;
  /** The latest parse attempt; null for a record entered or split off by hand. */
  revisionId: string | null;
  status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
  submittedAt: string;
  finalizedAt: string | null;
  entryDate: string | null;
  result: null | {
    title: string | null;
    /**
     * Accounting total in the ledger's main currency (convertedAmount sum);
     * null while an entry has no exchange rate for its day.
     */
    total: string | null;
    /** Three-letter ISO currency code of `total`, from the ledger's main currency. */
    totalCurrency: string;
    entries: Array<{
      name: string;
      description: string | null;
      amount: string;
      currency: string | null;
      category: string | null;
    }>;
  };
  /**
   * Sanitized failure information. `code` is always a stable, non-empty
   * public code; `message` is an optional user-facing explanation.
   */
  error: null | { code: string; message?: string | null };
}
