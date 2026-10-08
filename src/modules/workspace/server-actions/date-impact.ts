"use server";

import { z } from "zod";
import { withLedgerAction } from "@/modules/ledger/action-access";
import { parseLedgerEntryIds } from "@/modules/ledger/contract-schemas";
import { previewSourceDocumentDateImpact } from "@/modules/workspace/server/source-document-date-impact";
import { sourceDocumentIdsSchema } from "@/modules/source-document/contract-schemas";

const dateImpactInputSchema = z.object({
  sourceDocumentIds: sourceDocumentIdsSchema,
  ledgerEntryIds: z.array(z.unknown()),
});

export const previewSourceDocumentDateImpactAction = withLedgerAction(
  async (input: { sourceDocumentIds: string[]; ledgerEntryIds: string[] }) => {
    // The input is checked before any of it is read: a request without an id list
    // is a validation failure, not a TypeError.
    const parsed = dateImpactInputSchema.parse(input);
    return previewSourceDocumentDateImpact({
      sourceDocumentIds: parsed.sourceDocumentIds,
      // A selection of documents without entries has no entry ids, and still moves.
      ledgerEntryIds:
        parsed.ledgerEntryIds.length === 0 ? [] : parseLedgerEntryIds(parsed.ledgerEntryIds),
    });
  }
);
