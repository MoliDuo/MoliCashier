"use server";

import { cancelSourceDocumentProcessing } from "../server/cancel-processing";
import type { CancelProcessingResponseDto } from "@/modules/source-document/contracts";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withLedgerAction } from "@/modules/ledger/action-access";

export const cancelSourceDocumentProcessingAction = withLedgerAction(
  async (sourceDocumentId: string): Promise<CancelProcessingResponseDto> =>
    cancelSourceDocumentProcessing(parseSourceDocumentId(sourceDocumentId))
);
