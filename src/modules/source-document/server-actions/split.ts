"use server";

import { splitSourceDocumentAtomically } from "../server/split";
import type {
  SplitSourceDocumentInput,
  SplitSourceDocumentResultDto,
} from "@/modules/source-document/contracts";
import { splitSourceDocumentInputSchema } from "@/modules/source-document/contract-schemas";
import { withLedgerAction } from "@/modules/ledger/action-access";

export const splitSourceDocumentAction = withLedgerAction(
  async (input: SplitSourceDocumentInput): Promise<SplitSourceDocumentResultDto> => {
    const validated = splitSourceDocumentInputSchema.parse(input);
    return splitSourceDocumentAtomically(validated);
  }
);
