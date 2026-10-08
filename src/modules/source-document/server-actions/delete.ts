"use server";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withLedgerAction } from "@/modules/ledger/action-access";
import { deleteSourceDocumentAtomically } from "../server/delete";

/**
 * Delete a single source document. The row is removed (hard delete); its entries and extraction
 * attempts go with it through the foreign keys.
 */
export const deleteSourceDocumentAction = withLedgerAction(async (sourceId: string) =>
  deleteSourceDocumentAtomically({ sourceDocumentId: parseSourceDocumentId(sourceId) })
);
