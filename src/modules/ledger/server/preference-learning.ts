import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { logger } from "@/lib/logger";
import { aiCorrections, entryCategories, ledgers } from "@/persistence";
import {
  PREFERENCE_LEARNING_BACKGROUND_DAYS,
  PREFERENCE_LEARNING_MAX_BACKGROUND,
  PREFERENCE_LEARNING_MAX_NEW,
  PREFERENCE_LEARNING_MIN_CORRECTIONS,
} from "@/config/tuning";
import {
  buildPreferenceLearningMessage,
  buildPreferenceLearningPrompt,
  formatLearnedPreferences,
  preferenceLearningSchema,
  type CorrectionForLearning,
} from "@/modules/ledger/domain/preference-learning";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOKENS = 1200;
const TEMPERATURE = 0.2;

export type PreferenceLearningOutcome =
  /** Learning is switched off, or the ledger does not exist. */
  | "disabled"
  /** Fewer unread corrections than a run needs. */
  | "not_enough"
  /** The learned text changed while the model worked; nothing was written. */
  | "stale"
  | "updated";

function toLearning(row: typeof aiCorrections.$inferSelect): CorrectionForLearning {
  return {
    field: row.field,
    documentTitle: row.documentTitle,
    itemName: row.itemName,
    amount: row.amount,
    currency: row.currency,
    before: row.beforeValue,
    after: row.afterValue,
  };
}

/**
 * Distills the owner's unread corrections into the ledger's learned
 * preferences. The model call runs outside any transaction; the write lands
 * only while the learned text is still the one the run read, so a run racing
 * the owner's own edit, or another run, writes nothing and leaves the
 * corrections unread for the next pass. Logs counts, never content.
 */
export async function runPreferenceLearning(
  options: { now?: Date } = {}
): Promise<PreferenceLearningOutcome> {
  const now = options.now ?? new Date();
  const [ledger] = await db.select().from(ledgers).limit(1);
  if (ledger == null || !ledger.aiPreferenceLearningEnabled) return "disabled";

  const fresh = await db
    .select()
    .from(aiCorrections)
    .where(and(isNull(aiCorrections.consumedAt), lte(aiCorrections.updatedAt, now)))
    .orderBy(desc(aiCorrections.updatedAt), asc(aiCorrections.id))
    .limit(PREFERENCE_LEARNING_MAX_NEW);
  if (fresh.length < PREFERENCE_LEARNING_MIN_CORRECTIONS) return "not_enough";
  const [background, categories] = await Promise.all([
    db
      .select()
      .from(aiCorrections)
      .where(
        and(
          isNotNull(aiCorrections.consumedAt),
          gte(
            aiCorrections.updatedAt,
            new Date(now.getTime() - PREFERENCE_LEARNING_BACKGROUND_DAYS * DAY_MS)
          )
        )
      )
      .orderBy(desc(aiCorrections.updatedAt), asc(aiCorrections.id))
      .limit(PREFERENCE_LEARNING_MAX_BACKGROUND),
    db
      .select({ name: entryCategories.name })
      .from(entryCategories)
      .orderBy(asc(entryCategories.sortOrder), asc(entryCategories.id)),
  ]);

  const response = await generateStructured({
    task: "preference-learning",
    schema: preferenceLearningSchema,
    system: buildPreferenceLearningPrompt({ language: ledger.aiLanguage }),
    messages: [
      {
        role: "user",
        content: buildPreferenceLearningMessage({
          currentPreferences: ledger.aiLearnedPreferences,
          ownerInstructions: ledger.aiCustomPrompt,
          categories: categories.map((category) => category.name),
          fresh: fresh.map(toLearning),
          background: background.map(toLearning),
        }),
      },
    ],
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
  });
  const learned = formatLearnedPreferences(response.preferences);

  const written = await db.transaction(async (tx) => {
    const updated = await tx
      .update(ledgers)
      .set({ aiLearnedPreferences: learned, aiLearnedPreferencesUpdatedAt: now })
      .where(
        and(
          eq(ledgers.id, ledger.id),
          eq(ledgers.aiLearnedPreferences, ledger.aiLearnedPreferences),
          eq(ledgers.aiPreferenceLearningEnabled, true)
        )
      )
      .returning({ id: ledgers.id });
    if (updated.length === 0) return false;
    // A correction the owner changed again since it was read stays unread.
    await tx
      .update(aiCorrections)
      .set({ consumedAt: now })
      .where(
        and(
          inArray(
            aiCorrections.id,
            fresh.map((row) => row.id)
          ),
          isNull(aiCorrections.consumedAt),
          lte(aiCorrections.updatedAt, now)
        )
      );
    return true;
  });
  logger.info(
    { corrections: fresh.length, background: background.length, written },
    "Preference learning finished"
  );
  return written ? "updated" : "stale";
}
