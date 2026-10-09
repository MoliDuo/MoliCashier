import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { storedJudgmentSchema, type Judgment } from "@/modules/forecast/domain/judgment/schema";
import { forecastJudgments } from "@/persistence";

export interface StoredJudgment {
  asOf: string;
  inputFingerprint: string;
  createdAt: Date;
  judgment: Judgment;
}

function toStored(row: typeof forecastJudgments.$inferSelect): StoredJudgment | null {
  const parsed = storedJudgmentSchema.safeParse(row.judgment);
  return parsed.success
    ? {
        asOf: row.asOf,
        inputFingerprint: row.inputFingerprint,
        createdAt: row.createdAt,
        judgment: parsed.data,
      }
    : null;
}

/** The newest judgment of `scope` from `from` through `to`, or null. */
export async function latestJudgment(
  scope: string,
  range: { from: string; to: string }
): Promise<StoredJudgment | null> {
  const [row] = await db
    .select()
    .from(forecastJudgments)
    .where(
      and(
        eq(forecastJudgments.scope, scope),
        gte(forecastJudgments.asOf, range.from),
        lte(forecastJudgments.asOf, range.to)
      )
    )
    .orderBy(desc(forecastJudgments.asOf))
    .limit(1);
  return row == null ? null : toStored(row);
}

/**
 * Keeps a judgment, replacing one of the same scope and day. The empty phases
 * and everyday levels keep the judgment readable by the release before this
 * one, which still requires them; nothing reads them now. The judgments are
 * no longer backfilled.
 */
export async function saveJudgment(input: {
  scope: string;
  asOf: string;
  inputFingerprint: string;
  model: string;
  judgment: Judgment;
}): Promise<void> {
  const judgment = { phases: [], categories: [], ...input.judgment };
  await db
    .insert(forecastJudgments)
    .values({ ...input, backfilled: false, judgment })
    .onConflictDoUpdate({
      target: [forecastJudgments.scope, forecastJudgments.asOf],
      set: {
        inputFingerprint: input.inputFingerprint,
        model: input.model,
        backfilled: false,
        judgment,
        createdAt: new Date(),
      },
    });
}
