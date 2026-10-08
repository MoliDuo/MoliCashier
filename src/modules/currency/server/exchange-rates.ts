import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { exchangeRates } from "@/persistence";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { dateStringSchema } from "@/lib/validation";

// Per-day exchange rates in the exchange_rates table, fetched from Frankfurter.
// Conversions happen in SQL through convert_amount, which answers null for a
// day without rates; nothing here converts amounts itself.

const supportedCurrencySet = new Set<string>(SUPPORTED_CURRENCIES);

const providerCurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Invalid currency code");

const providerTimeSeriesSchema = z.object({
  base: z.literal("EUR"),
  rates: z.record(
    dateStringSchema,
    z.record(providerCurrencyCodeSchema, z.number().finite().positive())
  ),
});

/** Days before the first wanted one that are also requested, so a wanted day
 * that falls on a weekend or holiday has a publication to carry forward. */
const LOOKBACK_DAYS = 7;
const ENSURE_TIMEOUT_MS = 3_000;
const INSERT_CHUNK_ROWS = 1_000;
const API_BASE_URL = "https://api.frankfurter.app";

interface DayRates {
  rateDate: string;
  sourceDate: string;
  perEur: Record<string, number>;
}

// helpers
export function formatExchangeRateDate(date: Date | string): string {
  if (typeof date === "string") {
    const [datePart] = date.split("T");
    return dateStringSchema.parse(datePart ?? date);
  }

  return dateStringSchema.parse(date.toISOString().slice(0, 10));
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * The last day rates are fetched for. Ledger days are named in the ledger's
 * zone, which can be a day ahead of UTC, so a UTC bound would skip a record
 * dated today in, say, Shanghai before 08:00. No zone is more than a day
 * ahead of UTC; a day the provider has not published yet is stored as
 * provisional and replaced later.
 */
function latestRateDay(now: Date): string {
  return addDays(formatExchangeRateDate(now), 1);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Fetch with a fixed retry budget (default 3 attempts): network failures,
 * HTTP 408, 429, and 5xx are retried with exponential backoff (1s, 2s);
 * other 4xx responses are returned immediately so the caller can handle them.
 * Every request keeps a 5000ms timeout.
 */
export async function fetchWithRetry(url: string, retries = 3, delay = 1000): Promise<Response> {
  let lastError: unknown = new AppError(
    "Failed to fetch exchange rates",
    "EXCHANGE_RATES_FETCH_FAILED"
  );

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok || !isRetryableHttpStatus(response.status)) {
        return response;
      }
      lastError = new AppError(
        `Failed to fetch exchange rates: HTTP ${response.status}`,
        "EXCHANGE_RATES_FETCH_FAILED"
      );
    } catch (err) {
      lastError = err;
    }
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }

  throw lastError;
}

/**
 * Turns the provider's publications into one entry per wanted calendar day,
 * each carrying the latest publication on or before it. A day earlier than
 * every publication is left out.
 */
export function spreadToCalendarDays(
  published: Record<string, Record<string, number>>,
  wantedDays: readonly string[]
): DayRates[] {
  const publicationDays = Object.keys(published).sort();
  return [...wantedDays].sort().flatMap((rateDate) => {
    let sourceDate: string | undefined;
    for (const day of publicationDays) {
      if (day > rateDate) break;
      sourceDate = day;
    }
    if (sourceDate == null) return [];
    const perEur = Object.fromEntries(
      Object.entries(published[sourceDate]!).filter(([currency]) =>
        supportedCurrencySet.has(currency)
      )
    );
    return [{ rateDate, sourceDate, perEur: { ...perEur, EUR: 1 } }];
  });
}

async function fetchPublications(
  from: string,
  to: string,
  load: (url: string) => Promise<Response>
): Promise<Record<string, Record<string, number>>> {
  const response = await load(`${API_BASE_URL}/${from}..${to}?base=EUR`);
  if (!response.ok) {
    throw new AppError(
      `Failed to fetch exchange rates: HTTP ${response.status}`,
      "EXCHANGE_RATES_FETCH_FAILED"
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const result = providerTimeSeriesSchema.safeParse(payload);
  if (!result.success) {
    throw new AppError(
      "Invalid exchange-rate provider response",
      "EXCHANGE_RATES_INVALID_RESPONSE",
      502
    );
  }
  return result.data.rates;
}

/**
 * Stores the days' rates. A day already stored is replaced only while it is
 * provisional, and only when the new rates differ or have become final, so a
 * repeated fetch of an unchanged day does not tell every ledger to refresh.
 * A day is final once it has its own publication or two days have passed.
 */
async function storeDays(days: readonly DayRates[], fetchedAt: Date): Promise<void> {
  const rows = days.flatMap((day) =>
    Object.entries(day.perEur).map(([currency, perEur]) => ({
      rateDate: day.rateDate,
      currency,
      perEur: String(perEur),
      sourceDate: day.sourceDate,
      fetchedAt,
    }))
  );
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    await db
      .insert(exchangeRates)
      .values(rows.slice(start, start + INSERT_CHUNK_ROWS))
      .onConflictDoUpdate({
        target: [exchangeRates.rateDate, exchangeRates.currency],
        set: {
          perEur: sql`excluded.per_eur`,
          sourceDate: sql`excluded.source_date`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`NOT (
            ${exchangeRates.sourceDate} IS NOT DISTINCT FROM ${exchangeRates.rateDate}
            OR ${exchangeRates.fetchedAt} >= (${exchangeRates.rateDate} + 2)::timestamp AT TIME ZONE 'UTC'
          )
          AND (
            (${exchangeRates.perEur}, ${exchangeRates.sourceDate})
              IS DISTINCT FROM (excluded.per_eur, excluded.source_date)
            OR excluded.source_date = excluded.rate_date
            OR excluded.fetched_at >= (excluded.rate_date + 2)::timestamp AT TIME ZONE 'UTC'
          )`,
      });
  }
}

/** Fetches in flight in this process, by the days they cover. */
const fetchesInFlight = new Map<string, Promise<void>>();

/**
 * Fetches and stores the given days, sharing one request with any identical one already in flight:
 * attempts parsed side by side tend to ask for the same day at the same moment.
 */
function fetchAndStoreDays(
  wantedDays: readonly string[],
  load: (url: string) => Promise<Response>
): Promise<void> {
  const key = [...new Set(wantedDays)].sort().join(",");
  const inFlight = fetchesInFlight.get(key);
  if (inFlight != null) return inFlight;
  const fetching = fetchAndStoreDaysOnce(wantedDays, load).finally(() => {
    fetchesInFlight.delete(key);
  });
  fetchesInFlight.set(key, fetching);
  return fetching;
}

async function fetchAndStoreDaysOnce(
  wantedDays: readonly string[],
  load: (url: string) => Promise<Response>
): Promise<void> {
  const sorted = [...wantedDays].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first == null || last == null) return;
  const fetchedAt = new Date();
  const published = await fetchPublications(addDays(first, -LOOKBACK_DAYS), last, load);
  await storeDays(spreadToCalendarDays(published, sorted), fetchedAt);
}

/**
 * Makes a best effort to have rates for the given days before an entry is
 * written on them: one provider request, about three seconds, never throwing.
 * A day that still has no rates converts to null until maintenance fills it.
 * Days after today (in any zone) are skipped; they have no rates yet.
 */
export async function ensureExchangeRates(dates: readonly (string | null)[]): Promise<void> {
  const latest = latestRateDay(new Date());
  const candidates = [
    ...new Set(dates.filter((date): date is string => date != null && date <= latest)),
  ];
  if (candidates.length === 0) return;
  try {
    const stored = await db.execute<{ rate_date: string }>(sql`
      SELECT rate_date::text FROM exchange_rates
      WHERE currency = 'EUR' AND rate_date = ANY(${`{${candidates.join(",")}}`}::date[])
    `);
    const storedDays = new Set(stored.rows.map((row) => row.rate_date));
    const missing = candidates.filter((date) => !storedDays.has(date));
    await fetchAndStoreDays(missing, (url) =>
      fetch(url, { signal: AbortSignal.timeout(ENSURE_TIMEOUT_MS) })
    );
  } catch (error) {
    logger.warn(
      { errorCode: error instanceof AppError ? error.code : "EXCHANGE_RATES_ENSURE_FAILED" },
      "Exchange rates could not be ensured before a write"
    );
  }
}

/**
 * Fills the days documents need that have no rates and replaces provisional
 * days. Runs from the daily cron; a second run finds nothing left to fetch.
 */
export async function refreshExchangeRates(now = new Date()): Promise<void> {
  const latest = latestRateDay(now);
  const wanted = await db.execute<{ rate_date: string }>(sql`
    SELECT DISTINCT documents.document_date::text AS rate_date
    FROM source_documents documents
    WHERE documents.document_date <= ${latest}::date
      AND NOT EXISTS (
        SELECT 1 FROM exchange_rates rates
        WHERE rates.rate_date = documents.document_date AND rates.currency = 'EUR'
      )
    UNION
    SELECT rates.rate_date::text
    FROM exchange_rates rates
    WHERE rates.currency = 'EUR'
      AND rates.source_date IS DISTINCT FROM rates.rate_date
      AND rates.fetched_at < (rates.rate_date + 2)::timestamp AT TIME ZONE 'UTC'
  `);
  await fetchAndStoreDays(
    wanted.rows.map((row) => row.rate_date),
    (url) => fetchWithRetry(url)
  );
}

/** Converts one amount at the day's stored rate, fetching the day's rates first
 * if they are missing; null when no rate is available for that day. */
export async function convertAmount(input: {
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  date?: string;
}): Promise<string | null> {
  const date = formatExchangeRateDate(input.date ?? new Date());
  if (input.fromCurrency !== input.toCurrency) await ensureExchangeRates([date]);
  const result = await db.execute<{ converted: string | null }>(sql`
    SELECT convert_amount(${input.amount}::numeric, ${input.fromCurrency}, ${input.toCurrency},
      ${date}::date)::text AS converted
  `);
  return result.rows[0]?.converted ?? null;
}
