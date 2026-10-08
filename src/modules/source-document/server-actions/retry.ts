"use server";
import { retrySourceDocument } from "../server/retry";
import type { RetrySourceDocumentResponseDto } from "@/modules/source-document/contracts";
import {
  parseSourceDocumentId,
  retrySourceDocumentInputSchema,
  type RetrySourceDocumentInputContract,
} from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";

/**
 * Direct Retry: retry an existing source document with immutable evidence.
 *
 * Inherits the current evidence (text + files) and queues a new processing attempt
 * immediately. This is a "re-parse with same input" action.
 *
 * Direct retry never accepts input overrides — it always inherits evidence.
 * For editing evidence before retry, use `editRetrySourceDocumentAction`.
 */
export const retrySourceDocumentAction = withLedgerAccess(
  async (sourceDocumentId: string): Promise<RetrySourceDocumentResponseDto> => {
    const result = await retrySourceDocument({
      sourceDocumentId: parseSourceDocumentId(sourceDocumentId),
    });

    return result;
  }
);

/**
 * Edit Retry: retry an existing source document with user-provided evidence overrides.
 *
 * Unlike direct retry, this accepts optional text/storedFileIds/entryDate overrides
 * and opens the prefilled edit dialog on the client. Processing is scheduled immediately.
 *
 * For a simple re-parse with no changes, use `retrySourceDocumentAction`.
 */
export const editRetrySourceDocumentAction = withLedgerAccess(
  async (
    sourceDocumentId: string,
    input: RetrySourceDocumentInputContract
  ): Promise<RetrySourceDocumentResponseDto> => {
    const validatedSourceDocumentId = parseSourceDocumentId(sourceDocumentId);
    const parsedInput = retrySourceDocumentInputSchema.parse(input);
    // A retry sent without a day keeps the day the record already has,
    // including one the owner set by hand after the last parse.
    const validatedInput = {
      text: parsedInput.text,
      storedFileIds: parsedInput.storedFileIds,
      documentDate: parsedInput.documentDate ?? null,
    };

    const result = await retrySourceDocument({
      sourceDocumentId: validatedSourceDocumentId,
      input: validatedInput,
    });

    return result;
  }
);
