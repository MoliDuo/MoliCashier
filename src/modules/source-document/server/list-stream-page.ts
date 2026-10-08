import "server-only";
import { ValidationError } from "@/lib/errors";
import type { ListStreamPageInput, SourceDocumentListItemDto, StreamPage } from "../contracts";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { normalizeSearchTerm } from "@/lib/search";
import { getLedgerRefreshBaseline, getLedgerVersion } from "./ledger-changes";
import { listTargetSourceDocuments } from "./reads/list";
import { listLedgerEntryViewsBySourceDocumentIds } from "@/modules/ledger/server/entry-reads/list-ledger-entry-views-by-source-document-ids";
import { filterStreamEntries, streamCategoryFilter } from "../domain/stream-filter-policy";
import { createHash } from "node:crypto";
import { STREAM_PAGE_LIMIT } from "@/config/tuning";
import {
  decodeSourceDocumentStreamCursor,
  encodeSourceDocumentPageCursor,
  encodeSourceDocumentStreamCursor,
} from "../domain/stream-cursor";

// ---------------------------------------------------------------------------
// Stream cursor helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a cursor is compatible with the current generation and filter inputs.
 * Returns the decoded inner cursor string for a valid cursor, or null when no
 * cursor was provided (first-page fetch).
 * Throws ValidationError for malformed, incompatible, or stale cursors so the
 * caller can signal the client to restart from page one.
 */
function validateCursor(
  cursor: string | null | undefined,
  generation: string,
  filterHash: string
): string | null {
  if (cursor == null || cursor === "") return null;
  const decoded = decodeSourceDocumentStreamCursor(cursor);
  if (decoded == null) {
    throw new ValidationError("Invalid cursor format, restart required");
  }
  if (decoded.generation !== generation || decoded.filterHash !== filterHash) {
    throw new ValidationError("Stale stream cursor, restart required");
  }
  return encodeSourceDocumentPageCursor(decoded.page);
}

function filterFingerprint(input: ListStreamPageInput, search: string | undefined): string {
  const normalized = {
    bookId: input.bookId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    statuses: [...new Set(input.statuses ?? [])].sort(),
    search: search?.trim() ?? null,
    categoryId: input.categoryId ?? null,
    currency: input.currency ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Page query
// ---------------------------------------------------------------------------

export async function listStreamPage(input: ListStreamPageInput): Promise<StreamPage> {
  // Enforce page size cap (defense in depth beyond the action schema)
  const limit = Math.min(input.limit, STREAM_PAGE_LIMIT);
  const search = normalizeSearchTerm(input.search);
  const filterHash = filterFingerprint(input, search);
  const beforeVersion = await getLedgerVersion();
  const generation = beforeVersion.toString();

  // Validate cursor against the ledger generation and filter compatibility.
  // Throws ValidationError for malformed/incompatible cursors so the client
  // can discard stale pages and restart from page one.
  let innerCursor: string | null;
  try {
    innerCursor = validateCursor(input.cursor, generation, filterHash);
  } catch (error) {
    if (error instanceof ValidationError) {
      const baseline = await getLedgerRefreshBaseline();
      return {
        items: [],
        nextCursor: null,
        generation: baseline.version.toString(),
        hasTransitionalWork: baseline.hasTransitionalWork,
        restartRequired: true,
      };
    }
    throw error;
  }

  const page = await listTargetSourceDocuments({
    ...(input.bookId == null ? {} : { bookId: input.bookId }),
    ...(input.statuses != null && input.statuses.length > 0
      ? { statuses: input.statuses as unknown as SourceDocumentProcessingStatus[] }
      : {}),
    ...(input.startDate != null && input.startDate !== "" ? { startDate: input.startDate } : {}),
    ...(input.endDate != null && input.endDate !== "" ? { endDate: input.endDate } : {}),
    ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
    ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
    ...(search != null ? { search } : {}),
    ...streamCategoryFilter(input.categoryId),
    ...(input.currency != null ? { currency: input.currency } : {}),
    ...(innerCursor != null ? { cursor: innerCursor } : {}),
    limit,
  });

  // Batch-load ledger entries for items that need them (completed cards etc.)
  const entriesByDocId = await listLedgerEntryViewsBySourceDocumentIds({
    sourceDocumentIds: page.items.map((item) => item.id),
  });

  const items = page.items.map((item) => ({
    ...item,
    ledgerEntries: filterStreamEntries(entriesByDocId.get(item.id) ?? [], {
      ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
      ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
      ...(search != null ? { search } : {}),
      ...(input.categoryId != null ? { categoryId: input.categoryId } : {}),
      ...(input.currency != null ? { currency: input.currency } : {}),
    }),
  }));
  const baseline = await getLedgerRefreshBaseline();
  if (baseline.version !== beforeVersion) {
    return {
      items: [],
      nextCursor: null,
      generation: baseline.version.toString(),
      hasTransitionalWork: baseline.hasTransitionalWork,
      restartRequired: true,
    };
  }

  return {
    items: items as SourceDocumentListItemDto[],
    nextCursor: encodeSourceDocumentStreamCursor(generation, filterHash, page.nextCursor),
    generation,
    hasTransitionalWork: baseline.hasTransitionalWork,
  };
}
