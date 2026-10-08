import { postLedgerQuery, type LedgerQueryOptions } from "@/lib/queries/post-ledger-query";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";

/** Browser reads of the workspace, served by `/api/ledger-queries`. */

/**
 * The date-change preview for a mixed selection of documents and entries: a document without
 * entries still moves.
 */
export const fetchSourceDocumentDateImpact = (
  input: { sourceDocumentIds: string[]; ledgerEntryIds: string[] },
  options?: LedgerQueryOptions
) => postLedgerQuery<BatchEntryDateImpact>("source-document-date-impact", [input], options);
