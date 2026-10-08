import { or, sql, type SQL } from "drizzle-orm";
import { sourceDocuments } from "@/persistence";
import { cursorTimestampSql } from "@/lib/db/cursor-timestamp";
import {
  decodeSourceDocumentPageCursor,
  encodeSourceDocumentPageCursor,
} from "../../stream-cursor";

/**
 * The cursor's creation time, selected next to each list row. It is formatted
 * in SQL with microseconds so the next page starts exactly after the row.
 */
export const cursorCreatedAtSql = () => cursorTimestampSql(sourceDocuments.createdAt);

export function cursorCondition(cursor: string | null | undefined): SQL<unknown> | null {
  if (cursor == null || cursor === "") return null;
  const decoded = decodeSourceDocumentPageCursor(cursor);
  if (decoded == null) return null;
  // Compared as timestamptz in SQL, not through a JavaScript Date, which would
  // drop the microseconds. Older cursors carry milliseconds and still parse.
  const documentDate = sql`${decoded.documentDate}::date`;
  const createdAt = sql`${decoded.createdAt}::timestamptz`;
  return (
    or(
      sql`${sourceDocuments.documentDate} < ${documentDate}`,
      sql`(${sourceDocuments.documentDate} = ${documentDate}
        AND ${sourceDocuments.createdAt} < ${createdAt})`,
      sql`(${sourceDocuments.documentDate} = ${documentDate}
        AND ${sourceDocuments.createdAt} = ${createdAt}
        AND ${sourceDocuments.id} < ${decoded.id})`
    ) ?? null
  );
}

export function encodeCursor(row: {
  documentDate: string;
  cursorCreatedAt: string;
  id: string;
}): string {
  return encodeSourceDocumentPageCursor({
    documentDate: row.documentDate,
    createdAt: row.cursorCreatedAt,
    id: row.id,
  });
}
