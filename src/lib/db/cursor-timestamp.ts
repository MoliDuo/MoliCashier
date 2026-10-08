import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * A timestamptz formatted as a UTC ISO-8601 string with microseconds, for
 * keyset cursors. PostgreSQL keeps microseconds; a JavaScript Date keeps only
 * milliseconds, so a cursor built through Date can skip or repeat rows whose
 * timestamps differ below a millisecond. Compare the decoded value back with
 * `::timestamptz` in SQL for the same reason.
 */
export function cursorTimestampSql(column: SQLWrapper) {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
