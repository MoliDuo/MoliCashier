import { postLedgerQuery, type LedgerQueryOptions } from "@/lib/queries/post-ledger-query";
import type { PeriodQuery } from "@/modules/ledger/domain/period";
import type {
  GetStreamTotalInput,
  ListStreamPageInput,
  SourceDocumentDetailDto,
  SourceDocumentInputDto,
  StreamPage,
  StreamTotalDto,
} from "./contracts";
import type { LedgerRefreshRequest, LedgerRefreshResult } from "./contract-refresh";

/** Browser reads of source documents, served by `/api/ledger-queries`. */
export const fetchSourceDocumentDetail = (id: string, options?: LedgerQueryOptions) =>
  postLedgerQuery<SourceDocumentDetailDto | null>("detail", [id], options);

export const fetchSourceDocumentInput = (id: string, options?: LedgerQueryOptions) =>
  postLedgerQuery<SourceDocumentInputDto>("source-document-input", [id], options);

export const fetchStreamPage = (
  input: PeriodQuery<ListStreamPageInput>,
  options?: LedgerQueryOptions
) => postLedgerQuery<StreamPage>("stream", [input], options);

export const fetchStreamTotal = (
  input: PeriodQuery<GetStreamTotalInput>,
  options?: LedgerQueryOptions
) => postLedgerQuery<StreamTotalDto>("total", [input], options);

export const fetchStreamRefresh = (input: LedgerRefreshRequest, options?: LedgerQueryOptions) =>
  postLedgerQuery<LedgerRefreshResult>("refresh", [input], options);
