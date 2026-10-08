import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import type {
  ApplyDateOrganizationInput,
  ApplyDateOrganizationResultDto,
  DismissDateOrganizationInput,
} from "@/modules/source-document/contracts";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { lockLedgerForUpdate, lockSourceDocumentForUpdate } from "@/lib/db/transaction-locks";
import { assertSourceDocumentsNotProcessing } from "./write-guards";
import { copyDocumentInput } from "./document-input";
import { repointEntryCorrectionsInTransaction } from "@/modules/ledger/server/ai-corrections";
import { getSourceDocumentInTransaction } from "./reads/list";

function normalizeCurrency(value: string | null) {
  return value == null || value === "" ? "CNY" : value;
}

/**
 * Drops the suggestion the reader dismissed. One already replaced or gone is
 * left as it is; the suggestion is not part of the record's content (title,
 * date and entries), so the version is left alone.
 */
export async function dismissDateOrganization(
  input: DismissDateOrganizationInput
): Promise<{ dismissed: true }> {
  const current = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, input.sourceDocumentId),
    columns: { id: true },
  });
  if (current == null) throw new NotFoundError("Source document");
  await db
    .update(sourceDocuments)
    .set({ dateOrganizationSuggestion: null })
    .where(
      and(
        eq(sourceDocuments.id, input.sourceDocumentId),
        sql`${sourceDocuments.dateOrganizationSuggestion}->>'id' = ${input.suggestionId}`
      )
    );
  return { dismissed: true };
}

export async function applyDateOrganization(
  input: ApplyDateOrganizationInput
): Promise<ApplyDateOrganizationResultDto> {
  const [ledger, document] = await Promise.all([
    db.query.ledgers.findFirst({ columns: { mainCurrency: true } }),
    db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, input.sourceDocumentId),
    }),
  ]);
  if (ledger == null || document == null) throw new NotFoundError("Source document");
  if (document.dateOrganizationSuggestion?.id !== input.suggestionId)
    throw new ConflictError("Date organization suggestion is no longer current");
  const entries = await db.query.ledgerEntries.findMany({
    where: eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
    orderBy: [asc(ledgerEntries.position), asc(ledgerEntries.id)],
  });
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  for (const item of document.dateOrganizationSuggestion.items) {
    const current = entriesById.get(item.ledgerEntryId);
    if (
      current != null &&
      (current.itemName !== item.snapshot.itemName ||
        compare(current.amount, item.snapshot.amount) !== 0 ||
        normalizeCurrency(current.currency) !== item.snapshot.currency)
    )
      throw new ConflictError("A suggested entry changed before date organization");
  }
  const appliedIds = new Set(input.appliedGroupIds);
  const appliedGroups = input.groups.filter((group) => appliedIds.has(group.id));
  const requestedIds = appliedGroups.flatMap((group) => group.ledgerEntryIds);
  if (requestedIds.some((id) => !entriesById.has(id)))
    throw new ConflictError("Date organization contains an unknown entry");
  const assigned = new Set(requestedIds);
  let originalGroup =
    appliedGroups.find((group) => group.entryDate === document.documentDate) ?? null;
  if (assigned.size === entries.length && originalGroup == null) {
    originalGroup =
      [...appliedGroups]
        .filter((group) => group.entryDate != null)
        .sort((a, b) => b.entryDate!.localeCompare(a.entryDate!))[0] ?? null;
  }
  const destinationGroups = appliedGroups.filter(
    (group): group is typeof group & { entryDate: string } =>
      group.entryDate != null && group !== originalGroup
  );
  const redatedForeignDates = appliedGroups.flatMap((group) =>
    group.entryDate != null &&
    group.entryDate !== document.documentDate &&
    group.ledgerEntryIds.some((id) => entriesById.get(id)!.currency !== ledger.mainCurrency)
      ? [group.entryDate]
      : []
  );
  if (redatedForeignDates.length > 0) await ensureExchangeRates(redatedForeignDates);
  const createdIds = destinationGroups.map(() => crypto.randomUUID());
  const outcome = await db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const lockedDocument = await lockSourceDocumentForUpdate(tx, input.sourceDocumentId);
    if (lockedDocument.dateOrganizationSuggestion?.id !== input.suggestionId)
      throw new ConflictError("Source document changed before date organization");
    await assertSourceDocumentsNotProcessing(tx, [lockedDocument]);
    const currentEntries = await tx.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
      columns: { id: true, position: true },
      orderBy: [asc(ledgerEntries.position), asc(ledgerEntries.id)],
    });
    // Entries edited since the suggestion was read move as they are now; the
    // groups only need their entries still here, and whether every entry
    // moves must not have changed, since that picks the group that stays.
    const currentIds = new Set(currentEntries.map((entry) => entry.id));
    if (
      requestedIds.some((id) => !currentIds.has(id)) ||
      (assigned.size === entries.length) !== (assigned.size === currentEntries.length)
    )
      throw new ConflictError("Source document entries changed before date organization");
    const destinationByEntry = new Map<string, { documentId: string; entryDate: string }>();
    for (const [index, group] of destinationGroups.entries()) {
      const id = createdIds[index]!;
      await tx.insert(sourceDocuments).values({
        id,
        bookId: lockedDocument.bookId,
        title: lockedDocument.title,
        version: 1,
        documentDate: group.entryDate,
      });
      // Each new record keeps the evidence its entries were read from.
      await copyDocumentInput(tx, {
        fromDocumentId: input.sourceDocumentId,
        toDocumentId: id,
      });
      for (const entryId of group.ledgerEntryIds)
        destinationByEntry.set(entryId, { documentId: id, entryDate: group.entryDate });
    }

    // Every entry takes its place in its (possibly new) document, in one statement.
    const positions = new Map<string, number>();
    const moves = currentEntries.map((entry) => {
      const documentId = destinationByEntry.get(entry.id)?.documentId ?? input.sourceDocumentId;
      const position = positions.get(documentId) ?? 0;
      positions.set(documentId, position + 1);
      return sql`(${entry.id}::uuid, ${documentId}::uuid, ${position}::integer)`;
    });
    if (moves.length > 0) {
      await tx.execute(sql`
        UPDATE ${ledgerEntries} AS entry
        SET source_document_id = move.source_document_id, position = move.position,
            updated_at = ${new Date()}
        FROM (VALUES ${sql.join(moves, sql`, `)}) AS move(id, source_document_id, position)
        WHERE entry.id = move.id
      `);
    }
    await repointEntryCorrectionsInTransaction(tx, input.sourceDocumentId);
    const remainingItems = lockedDocument.dateOrganizationSuggestion.items.filter(
      (item) => !assigned.has(item.ledgerEntryId)
    );
    const remainingSuggestion =
      remainingItems.length === 0
        ? null
        : { ...lockedDocument.dateOrganizationSuggestion, items: remainingItems };
    const remainingDuplicateItems = (lockedDocument.duplicateSuggestion?.items ?? []).filter(
      (item) => !assigned.has(item.ledgerEntryId)
    );
    await tx
      .update(sourceDocuments)
      .set({
        version: sql`${sourceDocuments.version} + 1`,
        documentDate: originalGroup?.entryDate ?? lockedDocument.documentDate,
        dateOrganizationSuggestion: remainingSuggestion,
        duplicateSuggestion:
          lockedDocument.duplicateSuggestion == null || remainingDuplicateItems.length === 0
            ? null
            : { ...lockedDocument.duplicateSuggestion, items: remainingDuplicateItems },
        updatedAt: new Date(),
      })
      .where(eq(sourceDocuments.id, input.sourceDocumentId));
    const sourceDocument = await getSourceDocumentInTransaction(tx, input.sourceDocumentId);
    if (sourceDocument == null) throw new NotFoundError("Source document");
    return { sourceDocument } as const;
  });
  return { sourceDocument: outcome.sourceDocument, createdSourceDocumentIds: createdIds };
}
