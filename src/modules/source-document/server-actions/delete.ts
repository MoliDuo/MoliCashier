"use server";
import { parseSourceDocumentId } from "@/modules/source-document/contract-schemas";
import { withLedgerAccess } from "@/modules/ledger/access";
import { deleteSourceDocumentAtomically } from "../server/delete";

/**
 * Delete a single source document. The row is removed (hard delete); its entries and extraction
 * attempts go with it through the foreign keys.
 */
export const deleteSourceDocumentAction = withLedgerAccess(async (sourceId: string) =>
  deleteSourceDocumentAtomically({ sourceDocumentId: parseSourceDocumentId(sourceId) })
);
