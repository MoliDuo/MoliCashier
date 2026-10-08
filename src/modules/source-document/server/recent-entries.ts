import "server-only";
import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { RECENT_ENTRIES_MAX, RECENT_ENTRIES_WINDOW_DAYS } from "@/config/tuning";
import type { RecentEntryForParse } from "@/modules/source-document/domain/parse/contracts";
import type { RecentEntryTarget } from "@/modules/source-document/domain/duplicate-suggestion";

export interface RecentEntriesForParse {
  entries: RecentEntryForParse[];
  targets: Map<string, RecentEntryTarget>;
}

/**
 * The entries the ledger took in lately, for the parse to compare new evidence
 * against. Each gets a short handle (`R1`, `R2`, …) so the model answers with
 * that and never has to copy an id.
 */
export async function loadRecentEntriesForParse(
  sourceDocumentId: string,
  now: Date = new Date()
): Promise<RecentEntriesForParse> {
  const since = new Date(now.getTime() - RECENT_ENTRIES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      ledgerEntryId: ledgerEntries.id,
      sourceDocumentId: sourceDocuments.id,
      documentTitle: sourceDocuments.title,
      documentDate: sourceDocuments.documentDate,
      itemName: ledgerEntries.itemName,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
    })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, ledgerEntries.sourceDocumentId))
    .where(and(ne(sourceDocuments.id, sourceDocumentId), gte(sourceDocuments.createdAt, since)))
    .orderBy(desc(sourceDocuments.createdAt), desc(sourceDocuments.id), asc(ledgerEntries.position))
    .limit(RECENT_ENTRIES_MAX);

  const targets = new Map<string, RecentEntryTarget>();
  const entries = rows.map((row, index) => {
    const ref = `R${index + 1}`;
    targets.set(ref, {
      ledgerEntryId: row.ledgerEntryId,
      sourceDocumentId: row.sourceDocumentId,
    });
    return {
      ref,
      documentTitle: row.documentTitle,
      documentDate: row.documentDate,
      itemName: row.itemName,
      amount: row.amount,
      currency: row.currency,
    };
  });
  return { entries, targets };
}
