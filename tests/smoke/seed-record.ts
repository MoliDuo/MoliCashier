import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import pg from "pg";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
 * Files one record into `book` by writing it to the database, then opens the
 * current page again so it shows it.
 *
 * The AI stub answers every submission with the same bill, so a spec that
 * needs a record with a name or an amount of its own writes it here, the way
 * sign-in.ts writes the session. The record is dated today in the ledger's
 * zone and carries no parse attempt, which is how a bill split off another
 * one is stored.
 */
export async function seedRecord(
  page: Page,
  { item, amount, book }: { item: string; amount: string; book?: string }
): Promise<void> {
  const client = new pg.Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    await client.query("BEGIN");
    const ledger = await client.query<{ today: string }>(
      `SELECT (now() AT TIME ZONE time_zone)::date::text AS today FROM ledgers`
    );
    const today = ledger.rows[0]?.today;
    if (today == null) throw new Error("The smoke ledger is not seeded");
    const books = await client.query<{ id: string }>(
      `SELECT id FROM books
       WHERE archived_at IS NULL AND ($1::text IS NULL OR name = $1)
       ORDER BY sort_order LIMIT 1`,
      [book ?? null]
    );
    const bookId = books.rows[0]?.id;
    if (bookId == null) throw new Error(`The book ${book ?? ""} does not exist`);
    const categories = await client.query<{ id: string }>(
      `SELECT id FROM entry_categories ORDER BY sort_order LIMIT 1`
    );
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO source_documents (id, book_id, title, document_date)
       VALUES ($1, $2, $3, $4)`,
      [documentId, bookId, item, today]
    );
    await client.query(
      `INSERT INTO ledger_entries
         (id, category_id, source_document_id, position, amount, currency, item_name)
       VALUES ($1, $2, $3, 0, $4, 'CNY', $5)`,
      [randomUUID(), categories.rows[0]?.id ?? null, documentId, amount, item]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  // Not reload(): signIn() returns at `load`, while the home page may still be
  // redirecting, and a reload that meets it loses the page ("Not attached to an
  // active page"). goto takes over whatever navigation is in flight.
  await page.goto(page.url());
}
