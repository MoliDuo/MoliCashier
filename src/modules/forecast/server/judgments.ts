import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
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

/** Every judgment of `scope` from `from` on, newest first. */
export async function judgmentsSince(scope: string, from: string): Promise<StoredJudgment[]> {
  const rows = await db
    .select()
    .from(forecastJudgments)
    .where(and(eq(forecastJudgments.scope, scope), gte(forecastJudgments.asOf, from)))
    .orderBy(desc(forecastJudgments.asOf));
  return rows.flatMap((row) => toStored(row) ?? []);
}

/** Which of `days` already have a judgment of `scope`. */
export async function judgedDays(scope: string, days: readonly string[]): Promise<Set<string>> {
  if (days.length === 0) return new Set();
  const rows = await db
    .select({ asOf: forecastJudgments.asOf })
    .from(forecastJudgments)
    .where(and(eq(forecastJudgments.scope, scope), inArray(forecastJudgments.asOf, [...days])));
  return new Set(rows.map((row) => row.asOf));
}

/** Keeps a judgment, replacing one of the same scope and day. */
export async function saveJudgment(input: {
  scope: string;
  asOf: string;
  inputFingerprint: string;
  model: string;
  backfilled: boolean;
  judgment: Judgment;
}): Promise<void> {
  await db
    .insert(forecastJudgments)
    .values(input)
    .onConflictDoUpdate({
      target: [forecastJudgments.scope, forecastJudgments.asOf],
      set: {
        inputFingerprint: input.inputFingerprint,
        model: input.model,
        backfilled: input.backfilled,
        judgment: input.judgment,
        createdAt: new Date(),
      },
    });
}
