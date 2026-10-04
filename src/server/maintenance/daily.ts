import "server-only";
import { inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aiCorrections,
  categoryAssignmentJobs,
  forecastJudgments,
  sessions,
  sourceDocumentFiles,
  storedFiles,
} from "@/persistence";
import { getS3Storage } from "@/lib/storage/s3";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/concurrency";
import { AI_CORRECTIONS_RETENTION_DAYS, FORECAST_AI_RETENTION_DAYS } from "@/config/tuning";
import { runPreferenceLearning } from "@/modules/ledger/server/preference-learning";
import { refreshExchangeRates } from "@/modules/currency/server/exchange-rates";
import { trainForecasts } from "@/modules/forecast/server/train-forecasts";
import { judgeForecasts } from "@/modules/forecast/server/judge-ledger";

const BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a ready file may go unused before it is deleted. */
const UNUSED_FILE_GRACE_DAYS = 7;

export type DailyStep =
  | "expired_records"
  | "exchange_rates"
  | "unused_files"
  | "orphan_objects"
  | "preference_learning"
  | "forecast_models"
  | "forecast_judgments";

export type DailyStepOutcome = "done" | "failed";

export interface DailyMaintenanceOptions {
  now?: Date;
}

/**
 * The daily sweep. Each step is independent: one that fails is logged and the
 * rest still run. Extraction and category work is not part of the sweep: the
 * background worker picks it up as it comes due.
 */
export async function runDailyMaintenance(
  options: DailyMaintenanceOptions = {}
): Promise<Record<DailyStep, DailyStepOutcome>> {
  const now = options.now ?? new Date();
  const outcomes = {} as Record<DailyStep, DailyStepOutcome>;
  const step = async (name: DailyStep, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
      outcomes[name] = "done";
    } catch (error) {
      outcomes[name] = "failed";
      logger.warn(
        {
          step: name,
          errorName: error instanceof Error ? error.name : "UnknownError",
          // The class name does not survive the production build; the code does.
          ...(error instanceof AppError ? { errorCode: error.code } : {}),
        },
        "Daily maintenance step failed"
      );
    }
  };

  await step("expired_records", () => deleteExpiredRecords(now));
  await step("exchange_rates", () => refreshExchangeRates(now));
  await step("unused_files", () => deleteUnusedFiles(now));
  await step("orphan_objects", () => deleteOrphanObjects(now));
  await step("preference_learning", async () => {
    await runPreferenceLearning({ now });
  });
  // After the exchange rates, so the history it trains on is converted at today's rates.
  await step("forecast_models", trainForecasts);
  // The AI analyst's judgment, with the statistical model's first pass and the record of its past judgments.
  await step("forecast_judgments", judgeForecasts);
  return outcomes;
}

/** Deletes in batches until a batch comes back short. */
async function deleteInBatches(statement: SQL): Promise<void> {
  for (;;) {
    const result = await db.execute(statement);
    if ((result.rowCount ?? 0) < BATCH) return;
  }
}

async function deleteExpiredRecords(now: Date): Promise<void> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const corrections = new Date(now.getTime() - AI_CORRECTIONS_RETENTION_DAYS * DAY_MS);
  const judgments = new Date(now.getTime() - FORECAST_AI_RETENTION_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const statements = [
    sql`DELETE FROM ${sessions} WHERE id IN (
      SELECT id FROM ${sessions} WHERE expires_at < ${now} LIMIT ${BATCH}
    )`,
    // Result work rows cascade with the parent after the seven-day viewing window.
    sql`DELETE FROM ${categoryAssignmentJobs} WHERE id IN (
      SELECT id FROM ${categoryAssignmentJobs}
      WHERE status IN ('succeeded', 'partial', 'failed', 'cancelled')
        AND updated_at < ${sevenDaysAgo}
      LIMIT ${BATCH}
    )`,
    // A correction a learning run already read is kept as background for a while.
    sql`DELETE FROM ${aiCorrections} WHERE id IN (
      SELECT id FROM ${aiCorrections}
      WHERE consumed_at IS NOT NULL AND consumed_at < ${corrections}
      LIMIT ${BATCH}
    )`,
    // Judgments past the days their record is scored over.
    sql`DELETE FROM ${forecastJudgments} WHERE id IN (
      SELECT id FROM ${forecastJudgments} WHERE as_of < ${judgments}::date LIMIT ${BATCH}
    )`,
  ];
  for (const statement of statements) await deleteInBatches(statement);
}

/**
 * Deletes files that no document has used for a week, with their
 * objects. Rows go first: a submission attaching one of them meanwhile makes
 * the delete fail on the file link's foreign key rather than lose the file.
 */
async function deleteUnusedFiles(now: Date): Promise<void> {
  const weekAgo = new Date(now.getTime() - UNUSED_FILE_GRACE_DAYS * DAY_MS);
  const storage = getS3Storage();
  for (;;) {
    const deleted = await db.execute<{ storageKey: string }>(sql`
      DELETE FROM ${storedFiles} WHERE id IN (
        SELECT file.id FROM ${storedFiles} AS file
        WHERE file.created_at < ${weekAgo}
          AND NOT EXISTS (
            SELECT 1 FROM ${sourceDocumentFiles} AS link
            WHERE link.stored_file_id = file.id
          )
        LIMIT ${BATCH}
      )
      RETURNING storage_key AS "storageKey"
    `);
    await runWithConcurrency(
      deleted.rows.map((file) => file.storageKey),
      4,
      async (key) => {
        await storage.delete(key);
      }
    );
    if (deleted.rows.length < BATCH) return;
  }
}

/**
 * Deletes stored objects no row names, last written over a day ago: the
 * objects of deleted rows whose own delete failed. A row always exists before
 * its object is written, so a younger object without one is never a live
 * upload, and the day's margin covers clocks.
 */
async function deleteOrphanObjects(now: Date): Promise<void> {
  const dayAgo = now.getTime() - DAY_MS;
  const storage = getS3Storage();
  let continuationToken: string | null = null;
  do {
    const page = await storage.listObjectsPage("", continuationToken);
    const candidates = page.objects
      .filter(
        (object) =>
          object.key.startsWith("stored/") &&
          object.lastModified != null &&
          object.lastModified.getTime() < dayAgo
      )
      .map((object) => object.key);
    if (candidates.length > 0) {
      const known = await db
        .select({ storageKey: storedFiles.storageKey })
        .from(storedFiles)
        .where(inArray(storedFiles.storageKey, candidates));
      const knownKeys = new Set(known.map((file) => file.storageKey));
      await runWithConcurrency(
        candidates.filter((key) => !knownKeys.has(key)),
        4,
        async (key) => {
          await storage.delete(key);
        }
      );
    }
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken != null);
}
