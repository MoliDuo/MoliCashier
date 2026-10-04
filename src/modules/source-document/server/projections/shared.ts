import { eq, inArray } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/modules/source-document/server/projections/types";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isValidDecimal } from "@/lib/money/decimal";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";

export function activeDocumentWhere(sourceDocumentId: string) {
  return eq(sourceDocuments.id, sourceDocumentId);
}

export function assertEntryValues(entries: readonly LedgerProjectionEntryContract[]): void {
  for (const entry of entries) {
    if (entry.itemName.trim() === "" || !isValidDecimal(entry.amount)) {
      throw new ValidationError(
        "Ledger projection entries require an item name and numeric amount"
      );
    }
  }
}

export function requireCurrency(currency: string | null): string {
  if (currency == null) throw new ValidationError("Ledger projection entries require a currency");
  return currency;
}

export async function assertCategoryOwnership(
  tx: PostgresTransaction,
  entries: readonly { categoryId?: string | null | undefined }[]
): Promise<void> {
  const categoryIds = [
    ...new Set(entries.flatMap((entry) => (entry.categoryId == null ? [] : [entry.categoryId]))),
  ];
  if (categoryIds.length === 0) return;
  const owned = await tx
    .select({ id: entryCategories.id })
    .from(entryCategories)
    .where(inArray(entryCategories.id, categoryIds));
  if (owned.length !== categoryIds.length) {
    throw new NotFoundError("Entry category");
  }
}

export async function insertDocumentEntries(
  tx: PostgresTransaction,
  input: {
    sourceDocumentId: string;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<void> {
  if (input.entries.length === 0) return;
  await tx.insert(ledgerEntries).values(
    input.entries.map((entry, position) => ({
      id: entry.id ?? crypto.randomUUID(),
      sourceDocumentId: input.sourceDocumentId,
      position,
      categoryId: entry.categoryId,
      amount: entry.amount,
      currency: requireCurrency(entry.currency),
      itemName: entry.itemName,
      description: entry.description,
      extracted: entry.extracted ?? false,
      ...(entry.createdAt == null ? {} : { createdAt: new Date(entry.createdAt) }),
    }))
  );
}

/** Replaces every live entry of the document with the given ones. */
export async function replaceProjection(
  tx: PostgresTransaction,
  input: {
    sourceDocumentId: string;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<void> {
  assertEntryValues(input.entries);
  await assertCategoryOwnership(tx, input.entries);
  await tx.delete(ledgerEntries).where(eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId));
  await insertDocumentEntries(tx, input);
}
