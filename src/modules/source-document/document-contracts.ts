import type { SourceDocumentProcessingStatus } from "./types";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import type {
  ProcessingFailureCode,
  AttemptFailureKind,
  SupportedSourceDocumentAction,
} from "@/modules/source-document/lifecycle";

export interface SourceDocumentStoredFileDto {
  id: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
}

interface SourceDocumentSummaryDto {
  id: string;
  bookId?: string | null;
  version: number;
  /** The latest parse attempt; null for a record entered or split off by hand. */
  latestAttemptId: string | null;
  title: string | null;
  processingStatus: SourceDocumentProcessingStatus | null;
  failureKind: AttemptFailureKind | null;
  failureMessage: string | null;
  /** The day the record counts on, in the ledger's zone. */
  documentDate: string;
  createdAt: string;
  updatedAt: string;
  supportedActions: SupportedSourceDocumentAction[];
  canEdit: boolean;
  errorCode: ProcessingFailureCode | null;
}

interface SourceDocumentInputDataDto {
  text: string | null;
  files: SourceDocumentStoredFileDto[];
}

export interface DuplicateSuggestionItemDto {
  ledgerEntryId: string;
  itemName: string;
  amount: string;
  currency: string;
  /** The recorded entry this one repeats, and the record that holds it. */
  matched: {
    sourceDocumentId: string;
    title: string | null;
    documentDate: string;
    itemName: string;
  };
}

export interface DuplicateSuggestionDto {
  id: string;
  items: DuplicateSuggestionItemDto[];
  /** Every entry of the record is flagged, so removing them leaves nothing. */
  coversWholeDocument: boolean;
}

/** A suggestion the owner has not yet confirmed or dismissed. */
export type PendingSuggestionKind = "duplicate" | "date_organization";

export interface SourceDocumentDetailDto
  extends SourceDocumentSummaryDto, SourceDocumentInputDataDto {
  ledgerEntries: LedgerEntryEmbeddedViewDto[];
  hasImages: boolean;
  activeResultSummary?: SourceDocumentActiveResultSummary;
  dateOrganizationSuggestion?:
    import("@/lib/ai/date-organization").DateOrganizationSuggestion | null;
  duplicateSuggestion?: DuplicateSuggestionDto | null;
}

export interface SourceDocumentActiveResultSummary {
  entryCount: number;
  /** Null while an entry has no exchange rate for its day. */
  total: string | null;
}

export interface SourceDocumentListItemDto extends SourceDocumentSummaryDto {
  text: null;
  pendingSuggestions: PendingSuggestionKind[];
  ledgerEntries?: LedgerEntryEmbeddedViewDto[];
  hasImages: boolean;
}

export interface StreamPage {
  items: SourceDocumentListItemDto[];
  nextCursor: string | null;
  generation: string;
  hasTransitionalWork: boolean;
  /** When true, indicates the cursor was invalid — the client should discard
   *  all cached pages and restart the stream from page one. */
  restartRequired?: boolean;
}

export interface StreamTotalDto {
  total: string;
  unconvertedCount: number;
}

export interface SourceDocumentInputDto extends SourceDocumentInputDataDto {
  id: string;
  processingStatus: SourceDocumentProcessingStatus | null;
  documentDate: string | null;
  createdAt: string;
}
