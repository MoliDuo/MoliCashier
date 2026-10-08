export const SOURCE_DOCUMENT_PROCESSING_STATUSES = [
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type SourceDocumentProcessingStatus = (typeof SOURCE_DOCUMENT_PROCESSING_STATUSES)[number];

export function canonicalizeSourceDocumentProcessingStatuses(
  statuses: readonly SourceDocumentProcessingStatus[] | undefined
): SourceDocumentProcessingStatus[] | undefined {
  if (statuses == null || statuses.length === 0) return undefined;
  return [...new Set(statuses)].sort();
}
