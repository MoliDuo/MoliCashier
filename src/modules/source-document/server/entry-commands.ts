import { assertExpenseAmountDirection } from "@/modules/source-document/domain/expense-amount";
import { and, eq, getTableColumns, inArray } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/modules/source-document/server/projections/types";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";
import "server-only";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { compare as compareDecimal } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { replaceDocumentEntriesInTransaction } from "./projections/manual-entries";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import {
  lockLedgerForUpdate,
  lockSourceDocumentForUpdate,
  lockSourceDocumentsForUpdate,
} from "@/lib/db/transaction-locks";
import { assertCategoryOwnership } from "./projections/shared";

export async function listProjectionEntries(tx: PostgresTransaction, sourceDocumentId: string) {
  return tx.query.ledgerEntries.findMany({
    where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
    orderBy: (entries, { asc }) => [asc(entries.position), asc(entries.id)],
  });
}

export function toProjectionEntry(
  entry: typeof ledgerEntries.$inferSelect
): LedgerProjectionEntryContract {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    createdAt: entry.createdAt.toISOString(),
  };
}

function changed(
  entry: typeof ledgerEntries.$inferSelect,
  input: {
    categoryId?: string | null;
    amount?: string;
    currency?: string | null;
    itemName?: string;
    description?: string | null;
  }
) {
  return (
    (input.categoryId !== undefined && input.categoryId !== entry.categoryId) ||
    (input.amount !== undefined && compareDecimal(input.amount, entry.amount) !== 0) ||
    (input.currency !== undefined && input.currency !== entry.currency) ||
    (input.itemName !== undefined && input.itemName !== entry.itemName) ||
    (input.description !== undefined && input.description !== entry.description)
  );
}

/**
 * The stored amount under another currency. Changing only the currency never
 * rounds the amount, which could not be undone: one with more decimals than
 * the new currency has is refused instead.
 */
function amountInCurrency(amount: string, currency: string, nextCurrency: string): string {
  if (nextCurrency === currency) return amount;
  if (compareDecimal(roundToCurrency(amount, nextCurrency), amount) !== 0) {
    throw new ValidationError(`Amount has more decimal places than ${nextCurrency} allows`);
  }
  return amount;
}

/**
 * Caches the rates an entry in a foreign currency is read at before it is
 * written. Best effort: the entry saves either way.
 */
async function prepareCreate(input: {
  sourceDocumentId: string;
  currency?: string;
}): Promise<void> {
  const context = await db
    .select({
      mainCurrency: ledgers.mainCurrency,
      documentDate: sourceDocuments.documentDate,
    })
    .from(sourceDocuments)
    .crossJoin(ledgers)
    .where(eq(sourceDocuments.id, input.sourceDocumentId))
    .then((rows) => rows[0]);
  if (context == null) throw new NotFoundError("Source document");
  if (input.currency != null && input.currency !== context.mainCurrency) {
    await ensureExchangeRates([context.documentDate]);
  }
}

/**
 * Checks the new amounts keep each entry's direction and, when the currency
 * changes, caches the rates the entries are read at.
 */
async function prepareBatchUpdate(input: {
  sourceDocumentIds: string[];
  ledgerEntryIds: string[];
  amount?: string;
  currency?: string | null;
}): Promise<void> {
  if (input.amount === undefined && input.currency === undefined) return;
  const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
  const rows = await db
    .select({
      mainCurrency: ledgers.mainCurrency,
      documentDate: sourceDocuments.documentDate,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
    })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        inArray(sourceDocuments.id, input.sourceDocumentIds)
      )
    )
    .crossJoin(ledgers)
    .where(inArray(ledgerEntries.id, requestedIds));
  if (rows.length !== requestedIds.length) {
    throw new NotFoundError("Active ledger entry projection");
  }
  const foreignDates: string[] = [];
  for (const entry of rows) {
    const nextCurrency = input.currency !== undefined ? input.currency : entry.currency;
    const effectiveCurrency = nextCurrency ?? entry.mainCurrency;
    assertExpenseAmountDirection(entry.amount, input.amount ?? entry.amount, effectiveCurrency);
    if (effectiveCurrency !== entry.mainCurrency) foreignDates.push(entry.documentDate);
  }
  // Amounts convert when they are read; fetch a foreign amount's day's rate
  // now so that conversion has it, whether the edit changed the currency or
  // only the amount.
  if (foreignDates.length > 0) await ensureExchangeRates(foreignDates);
}

export interface AddLedgerEntryInput {
  sourceDocumentId: string;
  amount: string;
  currency?: string;
  itemName: string;
  categoryId?: string;
  description?: string | null;
}

export interface BatchUpdateLedgerEntriesInput {
  sourceDocumentIds: string[];
  ledgerEntryIds: string[];
  categoryId?: string | null;
  amount?: string;
  currency?: string | null;
  itemName?: string;
  description?: string | null;
}

export async function addLedgerEntry(
  input: AddLedgerEntryInput
): Promise<{ ledgerEntryId: string }> {
  await prepareCreate({
    sourceDocumentId: input.sourceDocumentId,
    ...(input.currency === undefined ? {} : { currency: input.currency }),
  });
  return db.transaction(async (tx) => {
    const ledger = await lockLedgerForUpdate(tx);
    const document = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    await assertCategoryOwnership(tx, [{ categoryId: input.categoryId }]);
    const entries = await listProjectionEntries(tx, document.id);
    const ledgerEntryId = crypto.randomUUID();
    const effectiveCurrency = input.currency ?? ledger.mainCurrency;
    // Positive as typed is not enough: 0.004 CNY rounds to nothing.
    const amount = roundToCurrency(input.amount, effectiveCurrency);
    if (compareDecimal(amount, "0") <= 0) {
      throw new ValidationError("Amount must be positive in the entry's currency");
    }
    await replaceDocumentEntriesInTransaction(tx, {
      document,
      previousEntries: entries,
      sourceDocumentId: document.id,
      entries: [
        ...entries.map(toProjectionEntry),
        {
          id: ledgerEntryId,
          categoryId: input.categoryId ?? null,
          amount,
          currency: effectiveCurrency,
          itemName: input.itemName,
          description: input.description ?? null,
        },
      ],
    });
    return { ledgerEntryId };
  });
}

export async function deleteLedgerEntry(input: {
  sourceDocumentId: string;
  ledgerEntryId: string;
}): Promise<{ ledgerEntryId: string; deleted: true }> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const document = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    const entries = await listProjectionEntries(tx, document.id);
    if (!entries.some((entry) => entry.id === input.ledgerEntryId)) {
      throw new NotFoundError("Active ledger entry projection");
    }
    await replaceDocumentEntriesInTransaction(tx, {
      document,
      previousEntries: entries,
      sourceDocumentId: document.id,
      entries: entries.filter((entry) => entry.id !== input.ledgerEntryId).map(toProjectionEntry),
    });
    return { ledgerEntryId: input.ledgerEntryId, deleted: true };
  });
}

export async function batchUpdateLedgerEntries(
  input: BatchUpdateLedgerEntriesInput
): Promise<{ ledgerEntryIds: string[]; affectedCount: number }> {
  await prepareBatchUpdate(input);
  return db.transaction(async (tx) => {
    const ledger = await lockLedgerForUpdate(tx);
    const documents = await lockSourceDocumentsForUpdate(tx, input.sourceDocumentIds);
    await assertCategoryOwnership(tx, [{ categoryId: input.categoryId }]);
    const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
    const requested = new Set(requestedIds);
    const activeEntries = await tx
      .select(getTableColumns(ledgerEntries))
      .from(ledgerEntries)
      .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
      .where(
        inArray(
          ledgerEntries.sourceDocumentId,
          documents.map((document) => document.id)
        )
      )
      .orderBy(ledgerEntries.sourceDocumentId, ledgerEntries.position, ledgerEntries.id);
    const entriesByDocument = new Map<string, typeof activeEntries>();
    for (const entry of activeEntries) {
      const group = entriesByDocument.get(entry.sourceDocumentId!) ?? [];
      group.push(entry);
      entriesByDocument.set(entry.sourceDocumentId!, group);
    }
    const selectedById = new Map(
      activeEntries
        .filter((entry) => requested.has(entry.id))
        .map((entry) => [entry.id, entry] as const)
    );
    if (selectedById.size !== requestedIds.length) {
      throw new NotFoundError("Active ledger entry projection");
    }
    const selectedDocumentIds = new Set(
      [...selectedById.values()].map((entry) => entry.sourceDocumentId!)
    );
    if (
      selectedDocumentIds.size !== input.sourceDocumentIds.length ||
      input.sourceDocumentIds.some((id) => !selectedDocumentIds.has(id))
    ) {
      throw new NotFoundError("Source document target");
    }

    const changedIds = new Set(
      [...selectedById.values()].filter((entry) => changed(entry, input)).map((entry) => entry.id)
    );
    if (changedIds.size === 0) return { ledgerEntryIds: requestedIds, affectedCount: 0 };

    const nextById = new Map<string, LedgerProjectionEntryContract>();
    for (const entry of selectedById.values()) {
      if (!changedIds.has(entry.id)) continue;
      const nextCurrency = input.currency !== undefined ? input.currency : entry.currency;
      const effectiveCurrency = nextCurrency ?? ledger.mainCurrency;
      nextById.set(entry.id, {
        ...toProjectionEntry(entry),
        categoryId: input.categoryId !== undefined ? input.categoryId : entry.categoryId,
        amount:
          input.amount !== undefined
            ? roundToCurrency(input.amount, effectiveCurrency)
            : amountInCurrency(entry.amount, entry.currency, effectiveCurrency),
        currency: input.currency !== undefined ? effectiveCurrency : entry.currency,
        itemName: input.itemName !== undefined ? input.itemName : entry.itemName,
        description: input.description !== undefined ? input.description : entry.description,
      });
    }

    const changedDocumentIds = new Set(
      [...selectedById.values()]
        .filter((entry) => changedIds.has(entry.id))
        .map((entry) => entry.sourceDocumentId!)
    );
    const changedDocuments = documents.filter((document) => changedDocumentIds.has(document.id));
    for (const document of changedDocuments) {
      const entries = entriesByDocument.get(document.id)!;
      await replaceDocumentEntriesInTransaction(tx, {
        document,
        previousEntries: entries,
        sourceDocumentId: document.id,
        entries: entries.map((entry) => nextById.get(entry.id) ?? toProjectionEntry(entry)),
      });
    }
    return { ledgerEntryIds: requestedIds, affectedCount: changedIds.size };
  });
}

export async function batchDeleteLedgerEntries(input: {
  sourceDocumentIds: string[];
  ledgerEntryIds: string[];
}): Promise<PartialBatchCommandResult> {
  const requestedIds = [...new Set(input.ledgerEntryIds)].sort();
  const result: PartialBatchCommandResult = { succeeded: [], failed: [] };
  const ownership = await db
    .select({
      id: ledgerEntries.id,
      sourceDocumentId: ledgerEntries.sourceDocumentId,
    })
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.id, requestedIds));
  const ownershipById = new Map(ownership.map((row) => [row.id, row] as const));
  const groups = new Map<string, string[]>();
  for (const id of requestedIds) {
    const row = ownershipById.get(id);
    if (row?.sourceDocumentId == null) {
      result.failed.push({ id, code: "NOT_FOUND" });
      continue;
    }
    const ids = groups.get(row.sourceDocumentId) ?? [];
    ids.push(id);
    groups.set(row.sourceDocumentId, ids);
  }
  const targets = new Set(input.sourceDocumentIds);
  for (const [sourceDocumentId, entryIds] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!targets.has(sourceDocumentId)) {
      result.failed.push(...entryIds.map((id) => ({ id, code: "MISSING_TARGET" })));
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        await lockLedgerForUpdate(tx);
        const document = await lockSourceDocumentForUpdate(tx, sourceDocumentId);
        const entries = await listProjectionEntries(tx, sourceDocumentId);
        const selected = new Set(entryIds);
        if (entryIds.some((id) => !entries.some((entry) => entry.id === id))) {
          throw new NotFoundError("Active ledger entry projection");
        }
        await replaceDocumentEntriesInTransaction(tx, {
          document,
          previousEntries: entries,
          sourceDocumentId,
          entries: entries.filter((entry) => !selected.has(entry.id)).map(toProjectionEntry),
        });
      });
      result.succeeded.push(...entryIds.map((id) => ({ id, sourceDocumentId })));
    } catch (error) {
      result.failed.push(
        ...entryIds.map((id) => ({
          id,
          code: error instanceof NotFoundError ? error.code : "INTERNAL",
        }))
      );
    }
  }
  return result;
}
