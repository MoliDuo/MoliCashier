import "server-only";
import { calculateCompletedSourceDocumentTotal } from "./reads/filters";
import type { GetStreamTotalInput, StreamTotalDto } from "../contracts";
import { normalizeSearchTerm } from "@/lib/search";
import { streamCategoryFilter } from "../domain/stream-filter-policy";

export async function getStreamTotal(input: GetStreamTotalInput = {}): Promise<StreamTotalDto> {
  if (
    input.statuses != null &&
    input.statuses.length > 0 &&
    !input.statuses.includes("completed")
  ) {
    return { total: "0", unconvertedCount: 0 };
  }

  const search = normalizeSearchTerm(input.search);
  const { search: _search, categoryId, ...filters } = input;
  return calculateCompletedSourceDocumentTotal({
    ...filters,
    ...(search != null ? { search } : {}),
    ...streamCategoryFilter(categoryId),
  });
}
