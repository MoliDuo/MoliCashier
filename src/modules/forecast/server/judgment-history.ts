import "server-only";
import { sql } from "drizzle-orm";
import { FORECAST_AI_INPUT_TEXT_CHARS } from "@/config/tuning";
import { db } from "@/lib/db";
import type { DigestCategory, DigestDocument } from "@/modules/forecast/domain/judgment/digest";

/**
 * Every document from `from` through `to` with its lines, as the AI analyst
 * reads them: title, the start of what the owner typed, and each line's name,
 * description, category, original amount and amount in the main currency. A
 * line with no rate for its day is left out, as the forecast leaves it out.
 */
export async function readJudgmentLedger(
  range: { from: string; to: string },
  bookId?: string
): Promise<{ documents: DigestDocument[]; categories: DigestCategory[] }> {
  const [rows, categories] = await Promise.all([
    db.execute<{
      documentId: string;
      date: string;
      title: string | null;
      inputText: string | null;
      itemName: string;
      description: string | null;
      categoryId: string | null;
      currency: string;
      amount: string;
      converted: string;
    }>(sql`
      SELECT documents.id AS "documentId", documents.document_date::text AS date,
        documents.title, left(documents.input_text, ${FORECAST_AI_INPUT_TEXT_CHARS * 2}) AS "inputText",
        entries.item_name AS "itemName", entries.description, entries.category_id AS "categoryId",
        entries.currency, entries.amount::text AS amount, converted.amount::text AS converted
      FROM source_documents documents
      JOIN ledger_entries entries
        ON entries.source_document_id = documents.id
      CROSS JOIN ledgers
      CROSS JOIN LATERAL (
        SELECT convert_amount(entries.amount, entries.currency, ledgers.main_currency,
          documents.document_date) AS amount
      ) converted
      WHERE documents.document_date BETWEEN ${range.from}::date AND ${range.to}::date
        ${bookId == null ? sql`` : sql`AND documents.book_id = ${bookId}`}
        AND converted.amount IS NOT NULL
      ORDER BY documents.document_date, documents.id, entries.position, entries.id
    `),
    db.execute<{ id: string; name: string; description: string | null }>(sql`
      SELECT id, name, description FROM entry_categories ORDER BY sort_order, id
    `),
  ]);

  const documents = new Map<string, DigestDocument>();
  for (const row of rows.rows) {
    let document = documents.get(row.documentId);
    if (document == null) {
      document = {
        id: row.documentId,
        date: row.date,
        title: row.title,
        inputText: row.inputText,
        entries: [],
      };
      documents.set(row.documentId, document);
    }
    document.entries.push({
      itemName: row.itemName,
      description: row.description,
      categoryId: row.categoryId,
      currency: row.currency,
      amount: row.amount,
      converted: row.converted,
    });
  }
  return { documents: [...documents.values()], categories: categories.rows };
}
