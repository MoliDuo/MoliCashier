interface SourceDocumentPageCursor {
  documentDate: string;
  createdAt: string;
  id: string;
}

export interface SourceDocumentStreamCursor {
  generation: string;
  filterHash: string;
  page: SourceDocumentPageCursor;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// ISO-8601 with up to microseconds; older cursors carry milliseconds.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function validTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function decodeSourceDocumentPageCursor(
  cursor: string | null | undefined
): SourceDocumentPageCursor | null {
  if (cursor == null || cursor === "") return null;
  const [documentDate, createdAt, id, ...rest] = cursor.split("|");
  if (
    rest.length > 0 ||
    documentDate == null ||
    createdAt == null ||
    id == null ||
    id === "" ||
    !validDate(documentDate) ||
    !validTimestamp(createdAt)
  ) {
    return null;
  }
  return { documentDate, createdAt, id };
}

export function encodeSourceDocumentPageCursor(cursor: SourceDocumentPageCursor): string {
  return `${cursor.documentDate}|${cursor.createdAt}|${cursor.id}`;
}

export function decodeSourceDocumentStreamCursor(
  cursor: string | null | undefined
): SourceDocumentStreamCursor | null {
  if (cursor == null || cursor === "") return null;
  const [version, generation, filterHash, ...pageParts] = cursor.split("|");
  if (
    version !== "v4" ||
    !/^\d+$/.test(generation ?? "") ||
    !/^[a-f0-9]{16}$/.test(filterHash ?? "")
  ) {
    return null;
  }
  const page = decodeSourceDocumentPageCursor(pageParts.join("|"));
  return page == null ? null : { generation: generation!, filterHash: filterHash!, page };
}

export function encodeSourceDocumentStreamCursor(
  generation: string,
  filterHash: string,
  pageCursor: string | null
): string | null {
  if (pageCursor == null) return null;
  const page = decodeSourceDocumentPageCursor(pageCursor);
  if (page == null) return null;
  return `v4|${generation}|${filterHash}|${encodeSourceDocumentPageCursor(page)}`;
}
