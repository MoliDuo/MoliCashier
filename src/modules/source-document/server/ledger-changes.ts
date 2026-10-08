import { sql } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";

interface ChangeSummaryRow extends Record<string, unknown> {
  currentVersion: string;
  hasTransitionalWork: boolean;
}

interface RefreshBaselineRow extends Record<string, unknown> {
  version: string;
  hasTransitionalWork: boolean;
}

/** The ledger's change watermark; 0 before its first change. */
export async function getLedgerVersion(): Promise<bigint> {
  const state = await db.query.ledgerSyncState.findFirst({
    columns: { version: true },
  });
  return state?.version ?? BigInt(0);
}

export async function getLedgerRefreshBaseline(): Promise<{
  version: bigint;
  hasTransitionalWork: boolean;
}> {
  const result = await db.execute<RefreshBaselineRow>(sql`
      SELECT
        COALESCE(
          (SELECT version FROM ledger_sync_state),
          0
        )::text AS version,
        EXISTS (
          SELECT 1
          FROM source_documents document
          JOIN extraction_attempts attempt
            ON attempt.source_document_id = document.id
           AND attempt.id = document.latest_attempt_id
          WHERE attempt.status = 'processing'
        ) AS "hasTransitionalWork"
    `);
  const row = result.rows[0];
  if (row == null) throw new Error("Ledger refresh baseline returned no row");
  return { version: BigInt(row.version), hasTransitionalWork: row.hasTransitionalWork };
}

/**
 * The ledger's current version and whether any record is still processing. The
 * per-resource watermarks the triggers also keep (categories, settings, stats)
 * are not read: any change moves the version, and a moved version refreshes
 * every visible read.
 */
export async function summarizeLedgerChanges(): Promise<{
  currentVersion: bigint;
  hasTransitionalWork: boolean;
}> {
  const result = await db.execute<ChangeSummaryRow>(sql`
      SELECT
        COALESCE(state.version, 0)::text AS "currentVersion",
        EXISTS (
          SELECT 1
          FROM source_documents document
          JOIN extraction_attempts attempt
            ON attempt.source_document_id = document.id
           AND attempt.id = document.latest_attempt_id
          WHERE attempt.status = 'processing'
        ) AS "hasTransitionalWork"
      FROM (SELECT 1) baseline
      LEFT JOIN ledger_sync_state state ON true
    `);
  const row = result.rows[0];
  if (row == null) {
    throw new Error("Ledger refresh summary returned no row");
  }
  return {
    currentVersion: BigInt(row.currentVersion),
    hasTransitionalWork: row.hasTransitionalWork,
  };
}
