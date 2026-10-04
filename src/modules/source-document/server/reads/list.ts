import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type {
  PendingSuggestionKind,
  SourceDocumentDetailDto,
} from "@/modules/source-document/contracts";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import type { PostgresTransaction } from "@/lib/db/transaction-locks";
import {
  entryConvertedAmountSql,
  entryExchangeRateSql,
} from "@/modules/currency/server/conversion-sql";

import { resolveDuplicateSuggestion } from "./duplicate-suggestion";
import type { TargetSourceDocumentListInput } from "./filters";
import { baseConditions } from "./filters";
import { cursorCondition, encodeCursor } from "./cursor";
import {
  mapListItem,
  mapSourceDocumentDetail,
  type SourceDocumentLedgerEntryAggregateRow,
  type SourceDocumentHydrationRow,
  type SourceDocumentListHydrationRow,
  type SourceDocumentRow,
  type SourceDocumentStoredFileAggregateRow,
} from "./mappers";

async function loadSourceDocumentDetailSnapshot(
  tx: PostgresTransaction,
  sourceDocumentId: string
): Promise<{ row: SourceDocumentRow; hydration: SourceDocumentHydrationRow } | null> {
  const baseRow = await tx
    .select({
      ...getTableColumns(sourceDocuments),
      mainCurrency: ledgers.mainCurrency,
      latestAttemptStatus: extractionAttempts.status,
      failureKind: extractionAttempts.failureKind,
      failureMessage: extractionAttempts.failureMessage,
      failureCode: extractionAttempts.failureCode,
    })
    .from(sourceDocuments)
    .crossJoin(ledgers)
    .leftJoin(
      extractionAttempts,
      and(
        eq(extractionAttempts.sourceDocumentId, sourceDocuments.id),
        eq(extractionAttempts.id, sourceDocuments.latestAttemptId)
      )
    )
    .where(eq(sourceDocuments.id, sourceDocumentId))
    .then((rows) => rows[0]);
  if (baseRow == null) return null;

  const fileRows: SourceDocumentStoredFileAggregateRow[] = await tx
    .select({
      id: storedFiles.id,
      contentType: storedFiles.contentType,
      byteSize: storedFiles.byteSize,
      originalFilename: storedFiles.originalFilename,
    })
    .from(sourceDocumentFiles)
    .innerJoin(storedFiles, eq(storedFiles.id, sourceDocumentFiles.storedFileId))
    .where(eq(sourceDocumentFiles.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(sourceDocumentFiles.position));

  const entryRows = await tx
    .select({
      id: ledgerEntries.id,
      categoryId: ledgerEntries.categoryId,
      sourceDocumentId: ledgerEntries.sourceDocumentId,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
      itemName: ledgerEntries.itemName,
      description: ledgerEntries.description,
      convertedAmount: entryConvertedAmountSql(),
      exchangeRate: entryExchangeRateSql(),
      createdAt: ledgerEntries.createdAt,
      updatedAt: ledgerEntries.updatedAt,
      category: entryCategories,
    })
    .from(ledgerEntries)
    .leftJoin(entryCategories, eq(entryCategories.id, ledgerEntries.categoryId))
    .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(ledgerEntries.position), asc(ledgerEntries.id));
  const activeEntries: SourceDocumentLedgerEntryAggregateRow[] = entryRows.map((entry) => ({
    id: entry.id,
    categoryId: entry.categoryId,
    sourceDocumentId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    convertedAmount: entry.convertedAmount,
    exchangeRate: entry.exchangeRate,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    category:
      entry.category == null
        ? null
        : {
            ...entry.category,
            createdAt: entry.category.createdAt.toISOString(),
            updatedAt: entry.category.updatedAt.toISOString(),
          },
  }));
  const duplicateSuggestion = await resolveDuplicateSuggestion(
    tx,
    baseRow.duplicateSuggestion,
    activeEntries
  );
  const pendingSuggestions: PendingSuggestionKind[] = [
    ...(duplicateSuggestion == null ? [] : (["duplicate"] as const)),
    ...(baseRow.dateOrganizationSuggestion == null ? [] : (["date_organization"] as const)),
  ];
  const hydration: SourceDocumentHydrationRow = {
    mainCurrency: baseRow.mainCurrency,
    inputText: baseRow.inputText,
    duplicateSuggestion,
    pendingSuggestions,
    processingStatus: baseRow.latestAttemptStatus,
    failureKind: baseRow.failureKind,
    failureMessage: baseRow.failureMessage,
    failureCode: baseRow.failureCode,
    hasImages: fileRows.length > 0,
    files: fileRows,
    ledgerEntries: activeEntries,
  };
  return { row: baseRow, hydration };
}

export async function listTargetSourceDocuments(input: TargetSourceDocumentListInput) {
  const conditions = baseConditions(input);
  const cursor = cursorCondition(input.cursor);
  if (cursor != null) conditions.push(cursor);
  const rows = await db
    .select({
      id: sourceDocuments.id,
      title: sourceDocuments.title,
      bookId: sourceDocuments.bookId,
      documentDate: sourceDocuments.documentDate,
      latestAttemptId: sourceDocuments.latestAttemptId,
      version: sourceDocuments.version,
      createdAt: sourceDocuments.createdAt,
      updatedAt: sourceDocuments.updatedAt,
      latestAttemptStatus: extractionAttempts.status,
      failureKind: extractionAttempts.failureKind,
      failureMessage: extractionAttempts.failureMessage,
      failureCode: extractionAttempts.failureCode,
      // Only a suggestion whose recorded counterpart still exists counts, so the
      // list agrees with the detail the suggestion opens.
      hasDuplicateSuggestion: sql<boolean>`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${sourceDocuments.duplicateSuggestion}->'items') list_suggestion_item
            INNER JOIN ${ledgerEntries} list_matched_entry
              ON list_matched_entry.id = (list_suggestion_item->'matched'->>'ledgerEntryId')::uuid
          )`,
      hasDateOrganizationSuggestion: sql<boolean>`${sourceDocuments.dateOrganizationSuggestion} IS NOT NULL`,
      hasImages: sql<boolean>`EXISTS (
            SELECT 1
            FROM ${sourceDocumentFiles} list_document_file
            INNER JOIN ${storedFiles} list_stored_file
              ON list_stored_file.id = list_document_file.stored_file_id
            WHERE list_document_file.source_document_id = ${sourceDocuments.id}
          )`,
    })
    .from(sourceDocuments)
    .leftJoin(
      extractionAttempts,
      and(
        eq(extractionAttempts.sourceDocumentId, sourceDocuments.id),
        eq(extractionAttempts.id, sourceDocuments.latestAttemptId)
      )
    )
    .where(and(...conditions))
    .orderBy(
      desc(sourceDocuments.documentDate),
      desc(sourceDocuments.createdAt),
      desc(sourceDocuments.id)
    )
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => {
      const hydration: SourceDocumentListHydrationRow = {
        processingStatus: row.latestAttemptStatus,
        failureKind: row.failureKind,
        failureMessage: row.failureMessage,
        failureCode: row.failureCode,
        hasImages: row.hasImages,
        pendingSuggestions: [
          ...(row.hasDuplicateSuggestion ? (["duplicate"] as const) : []),
          ...(row.hasDateOrganizationSuggestion ? (["date_organization"] as const) : []),
        ],
      };
      return mapListItem(row, hydration);
    }),
    nextCursor: hasMore && last != null ? encodeCursor(last) : null,
  };
}

export async function getTargetSourceDocument(
  sourceDocumentId: string
): Promise<SourceDocumentDetailDto | null> {
  return db.transaction((tx) => getSourceDocumentInTransaction(tx, sourceDocumentId), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

export async function getSourceDocumentInTransaction(
  tx: PostgresTransaction,
  sourceDocumentId: string
): Promise<SourceDocumentDetailDto | null> {
  const snapshot = await loadSourceDocumentDetailSnapshot(tx, sourceDocumentId);
  return snapshot == null ? null : mapSourceDocumentDetail(snapshot.row, snapshot.hydration);
}
