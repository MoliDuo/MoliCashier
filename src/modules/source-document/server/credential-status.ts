import { and, eq, sql } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";
import { ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import {
  toCredentialDocumentStatus,
  toStableFailureCode,
} from "@/modules/source-document/lifecycle";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { accountingTotal } from "@/lib/money/accounting-total";
import type { CredentialSourceDocumentStatusResult } from "@/modules/source-document/contracts";

/**
 * The record as API v1 reports it, or null when it does not exist or is filed
 * under another book than the credential's.
 */
export async function getCredentialSourceDocumentStatus(
  sourceDocumentId: string,
  bookId: string
): Promise<CredentialSourceDocumentStatusResult | null> {
  // Load the document, its latest attempt, its entries and the ledger's main
  // currency in a single query so status polling does not fan out into
  // sequential reads. The attempt must belong to the document; a record
  // entered by hand has none.
  const rows = await db
    .select({
      document: {
        id: sourceDocuments.id,
        title: sourceDocuments.title,
        documentDate: sourceDocuments.documentDate,
        createdAt: sourceDocuments.createdAt,
      },
      attempt: {
        id: extractionAttempts.id,
        status: extractionAttempts.status,
        failureKind: extractionAttempts.failureKind,
        failureCode: extractionAttempts.failureCode,
        failureMessage: extractionAttempts.failureMessage,
        submittedAt: extractionAttempts.submittedAt,
        finishedAt: extractionAttempts.finishedAt,
      },
      mainCurrency: ledgers.mainCurrency,
      entries: sql<
        Array<{
          name: string;
          description: string | null;
          amount: string;
          currency: string | null;
          convertedAmount: string | null;
          category: string | null;
        }>
      >`COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', entry.item_name,
            'description', entry.description,
            'amount', entry.amount::text,
            'currency', entry.currency,
            'convertedAmount', convert_amount(entry.amount, entry.currency,
              ${ledgers.mainCurrency}, ${sourceDocuments.documentDate})::text,
            'category', category.name
          ) ORDER BY entry.position, entry.created_at, entry.id)
          FROM ledger_entries entry
          LEFT JOIN entry_categories category ON category.id = entry.category_id
          WHERE entry.source_document_id = ${sourceDocuments.id}
        ), '[]'::jsonb)`,
    })
    .from(sourceDocuments)
    .leftJoin(
      extractionAttempts,
      and(
        eq(extractionAttempts.id, sourceDocuments.latestAttemptId),
        eq(extractionAttempts.sourceDocumentId, sourceDocuments.id)
      )
    )
    .crossJoin(ledgers)
    .where(and(eq(sourceDocuments.id, sourceDocumentId), eq(sourceDocuments.bookId, bookId)))
    .limit(1);
  const row = rows[0];
  if (row == null) return null;
  const { document, attempt } = row;
  const status = toCredentialDocumentStatus(attempt);
  let result: CredentialSourceDocumentStatusResult["result"] = null;
  if (status === "completed") {
    result = {
      title: document.title,
      total: accountingTotal(row.entries, row.mainCurrency),
      totalCurrency: row.mainCurrency,
      // Amounts are stored with three decimals; report each with its
      // currency's own precision ("1000" yen, not "1000.000").
      entries: row.entries.map(({ name, description, amount, currency, category }) => ({
        name,
        description,
        amount: currency == null ? amount : roundToCurrency(amount, currency),
        currency,
        category,
      })),
    };
  }
  // An unparsable document reports the stable VALIDATION_FAILED code plus the
  // natural-language reason the ledger owner reads, which may be absent.
  const error =
    status === "failed"
      ? { code: toStableFailureCode(attempt?.failureCode ?? null) }
      : status === "invalid"
        ? { code: "VALIDATION_FAILED", message: attempt?.failureMessage ?? null }
        : null;
  return {
    sourceDocumentId: document.id,
    revisionId: attempt?.id ?? null,
    status,
    submittedAt: (attempt?.submittedAt ?? document.createdAt).toISOString(),
    finalizedAt:
      attempt == null
        ? document.createdAt.toISOString()
        : (attempt.finishedAt?.toISOString() ?? null),
    entryDate: document.documentDate,
    result,
    error,
  };
}
