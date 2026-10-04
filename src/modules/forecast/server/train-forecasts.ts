import "server-only";
import { sql } from "drizzle-orm";
import { FORECAST_HISTORY_DAYS } from "@/config/tuning";
import { db } from "@/lib/db";
import { addCivilDays } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { readForecastHistory } from "./forecast-history";
import { forecastScope, trainScope } from "./model-registry";

/**
 * The nightly training: every book with spending in the history, and all of
 * them together, one after another, so the day's first forecasts find their
 * models ready.
 */
export async function trainForecasts(): Promise<void> {
  const settings = await getLedgerSettings();
  if (settings == null) return;
  const today = ledgerToday(settings.timeZone);
  const from = addCivilDays(today, -(FORECAST_HISTORY_DAYS - 1));
  const books = await db.execute<{ bookId: string }>(sql`
    SELECT DISTINCT book_id AS "bookId" FROM source_documents
    WHERE document_date BETWEEN ${from}::date AND ${today}::date
    ORDER BY book_id
  `);
  for (const bookId of [undefined, ...books.rows.map((row) => row.bookId)]) {
    const history = await readForecastHistory({ from, to: today }, bookId);
    await trainScope(forecastScope(bookId), history.rows, today);
  }
}
