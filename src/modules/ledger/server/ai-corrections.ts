import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import { aiCorrections, entryCategories, ledgerEntries, ledgers } from "@/persistence";
import {
  diffAiCorrections,
  nextCorrectionWrite,
  UNCATEGORIZED_VALUE,
  type AiCorrectionChange,
  type CorrectableEntry,
  type PreviousCorrectableEntry,
} from "@/modules/ledger/domain/ai-corrections";

/**
 * Records what a hand edit changed in what the AI wrote, inside the edit's own
 * transaction so a correction exists exactly when the edit does. Does nothing
 * while the owner has learning switched off.
 */
export async function recordAiCorrectionsInTransaction(
  tx: PostgresTransaction,
  input: {
    sourceDocumentId: string;
    /** The entries as they were before the edit; absent for an edit of the title alone. */
    previousEntries?: readonly PreviousCorrectableEntry[];
    nextEntries?: readonly CorrectableEntry[];
    previousTitle: string | null;
    /** The title the edit sets; absent when it leaves the title alone. */
    nextTitle?: string | undefined;
  }
): Promise<void> {
  if (input.previousEntries == null && input.nextTitle === undefined) return;
  const [ledger] = await tx
    .select({ enabled: ledgers.aiPreferenceLearningEnabled })
    .from(ledgers)
    .limit(1);
  if (ledger?.enabled !== true) return;

  const titleChanged = input.nextTitle !== undefined && input.nextTitle !== input.previousTitle;
  const previousEntries = input.previousEntries ?? [];
  let titleFromAi = false;
  if (titleChanged) {
    titleFromAi =
      input.previousEntries != null
        ? input.previousEntries.some((entry) => entry.extracted)
        : (
            await tx
              .select({ id: ledgerEntries.id })
              .from(ledgerEntries)
              .where(
                and(
                  eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
                  eq(ledgerEntries.extracted, true)
                )
              )
              .limit(1)
          ).length > 0;
  }

  const categoryIds = new Set<string>();
  const nextEntries = input.nextEntries ?? [];
  for (const entry of previousEntries)
    if (entry.categoryId != null) categoryIds.add(entry.categoryId);
  for (const entry of nextEntries) if (entry.categoryId != null) categoryIds.add(entry.categoryId);
  const names = new Map<string, string>();
  if (categoryIds.size > 0) {
    const rows = await tx
      .select({ id: entryCategories.id, name: entryCategories.name })
      .from(entryCategories)
      .where(inArray(entryCategories.id, [...categoryIds]));
    for (const row of rows) names.set(row.id, row.name);
  }

  const changes = diffAiCorrections({
    previousEntries,
    nextEntries,
    categoryName: (categoryId) =>
      categoryId == null ? UNCATEGORIZED_VALUE : (names.get(categoryId) ?? UNCATEGORIZED_VALUE),
    ...(input.nextTitle === undefined
      ? {}
      : {
          document: {
            id: input.sourceDocumentId,
            previousTitle: input.previousTitle,
            nextTitle: input.nextTitle,
          },
        }),
    titleFromAi,
  });
  if (changes.length === 0) return;
  await writeCorrections(
    tx,
    input.sourceDocumentId,
    input.nextTitle ?? input.previousTitle,
    changes
  );
}

async function writeCorrections(
  tx: PostgresTransaction,
  sourceDocumentId: string,
  documentTitle: string | null,
  changes: readonly AiCorrectionChange[]
): Promise<void> {
  const existingRows = await tx
    .select()
    .from(aiCorrections)
    .where(
      inArray(aiCorrections.subjectId, [...new Set(changes.map((change) => change.subjectId))])
    );
  const existingByKey = new Map(existingRows.map((row) => [`${row.subjectId}:${row.field}`, row]));
  const now = new Date();
  for (const change of changes) {
    const existing = existingByKey.get(`${change.subjectId}:${change.field}`) ?? null;
    const write = nextCorrectionWrite(existing, change);
    if (write.kind === "none") continue;
    if (write.kind === "delete") {
      await tx.delete(aiCorrections).where(eq(aiCorrections.id, existing!.id));
      continue;
    }
    const values = {
      documentTitle,
      itemName: change.context.itemName,
      amount: change.context.amount,
      currency: change.context.currency,
      beforeValue: write.beforeValue,
      afterValue: write.afterValue,
      consumedAt: null,
      updatedAt: now,
    };
    await tx
      .insert(aiCorrections)
      .values({ sourceDocumentId, subjectId: change.subjectId, field: change.field, ...values })
      .onConflictDoUpdate({
        target: [aiCorrections.subjectId, aiCorrections.field],
        set: values,
      });
  }
}

/** A title the AI writes replaces the one a stored correction was about. */
export async function forgetTitleCorrectionInTransaction(
  tx: PostgresTransaction,
  sourceDocumentId: string
): Promise<void> {
  await tx
    .delete(aiCorrections)
    .where(and(eq(aiCorrections.subjectId, sourceDocumentId), eq(aiCorrections.field, "title")));
}
