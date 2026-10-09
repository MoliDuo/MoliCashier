import "server-only";
import {
  FORECAST_AI_EXPECTED_DAYS,
  FORECAST_AI_INPUT_MAX_CHARS,
  FORECAST_AI_INPUT_TEXT_CHARS,
  FORECAST_AI_MAX_ATTEMPTS,
  FORECAST_AI_MAX_TOKENS,
  FORECAST_AI_REASONING_EFFORT,
  FORECAST_AI_JUDGE_EVERY_DAYS,
  FORECAST_AI_REFRESH_MINUTES,
  FORECAST_AI_TIMEOUT_MS,
  FORECAST_REFERENCE_PATHS,
  FORECAST_CHANGE_DISCOUNT,
  FORECAST_HALF_LIFE_DAYS,
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_HISTORY_DAYS,
} from "@/config/tuning";
import { generateStructured } from "@/lib/ai/structured";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { forecastPeriod } from "@/modules/forecast/domain/forecast";
import {
  buildJudgmentDigest,
  type DigestReference,
} from "@/modules/forecast/domain/judgment/digest";
import { buildJudgmentPrompt } from "@/modules/forecast/domain/judgment/prompt";
import {
  judgmentResponseSchema,
  resolveJudgment,
  type Judgment,
} from "@/modules/forecast/domain/judgment/schema";
import { isCurrentJudgmentVersion } from "@/modules/forecast/domain/judgment/fingerprint";
import { historyFingerprint } from "@/modules/forecast/server/history-fingerprint";
import { seedOf } from "@/modules/forecast/domain/random";
import type { HistoryRow } from "@/modules/forecast/domain/series";
import { addCivilDays, calendarRangeOf, civilDaysBetween } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { readForecastHistory, type ForecastHistory } from "./forecast-history";
import { readJudgmentLedger } from "./judgment-history";
import { latestJudgment, saveJudgment, type StoredJudgment } from "./judgments";

const TEMPERATURE = 0.2;
const MINUTE_MS = 60_000;

// The bookkeeping of runs lives on `globalThis`: the nightly step runs from instrumentation and the
// page's reads from route bundles. The judgments themselves are in the database.

interface Registry {
  running: Map<string, Promise<void>>;
  attemptedAt: Map<string, number>;
}

const REGISTRY_KEY = Symbol.for("cashier.forecast.judgments");

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (holder[REGISTRY_KEY] ??= {
    running: new Map(),
    attemptedAt: new Map(),
  });
}

/** The statistical model's settings for the reference the AI is handed: fewer paths than the page. */
const STATISTICAL = {
  halfLifeDays: FORECAST_HALF_LIFE_DAYS,
  changeDiscount: FORECAST_CHANGE_DISCOUNT,
  paths: FORECAST_REFERENCE_PATHS,
  seed: seedOf("judgment"),
  minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
};

/** What the statistical model makes of the history as of `asOf`, as the AI's first pass. */
function statisticalReference(rows: readonly HistoryRow[], asOf: string): DigestReference | null {
  const month = calendarRangeOf("month", asOf);
  const forecast = forecastPeriod({
    rows,
    today: asOf,
    period: { from: month.from, end: month.to === asOf ? addCivilDays(asOf, 30) : month.to },
    options: STATISTICAL,
  });
  if (forecast == null) return null;
  const bills = new Map<string, DigestReference["bills"][number]>();
  for (const bill of forecast.upcoming) {
    const key = `${bill.label}|${bill.key}`;
    if (!bills.has(key)) {
      bills.set(key, {
        label: bill.label,
        key: bill.key,
        amount: bill.amount,
        cadence: bill.cadence,
        next: bill.date,
      });
    }
  }
  return {
    lifeChange: forecast.lifeChange,
    largeFrom: forecast.largeFrom,
    bills: [...bills.values()],
    outlook: forecast.categories.map((category) => ({ key: category.key, ...category.forecast })),
  };
}

/**
 * Asks the AI analyst for its judgment of `scope` as of `asOf`, from only
 * what was recorded by then, and keeps it. Logs counts and sizes, never
 * content.
 */
async function judge(input: {
  scope: string;
  bookId: string | undefined;
  history: ForecastHistory;
  asOf: string;
  language: string | undefined;
}): Promise<Judgment> {
  const { scope, bookId, history, asOf } = input;
  const rows = history.rows.filter((row) => row.date <= asOf);
  const ledger = await readJudgmentLedger(
    { from: addCivilDays(asOf, -(FORECAST_HISTORY_DAYS - 1)), to: asOf },
    bookId
  );
  const digest = buildJudgmentDigest({
    asOf,
    mainCurrency: history.mainCurrency,
    categories: ledger.categories,
    documents: ledger.documents,
    reference: statisticalReference(rows, asOf),
    maxChars: FORECAST_AI_INPUT_MAX_CHARS,
    inputTextChars: FORECAST_AI_INPUT_TEXT_CHARS,
  });
  const response = await generateStructured({
    task: "forecast-judgment",
    schema: judgmentResponseSchema,
    system: buildJudgmentPrompt({
      expectedDays: FORECAST_AI_EXPECTED_DAYS,
      ...(input.language == null ? {} : { language: input.language }),
    }),
    messages: [{ role: "user", content: digest.text }],
    maxTokens: FORECAST_AI_MAX_TOKENS,
    temperature: TEMPERATURE,
    timeoutMs: FORECAST_AI_TIMEOUT_MS,
    maxAttempts: FORECAST_AI_MAX_ATTEMPTS,
    reasoningEffort: FORECAST_AI_REASONING_EFFORT,
  });
  const judgment = resolveJudgment(response, digest.refs, {
    asOf,
    expectedDays: FORECAST_AI_EXPECTED_DAYS,
  });
  await saveJudgment({
    scope,
    asOf,
    inputFingerprint: historyFingerprint(history.rows, asOf),
    model: runtimeEnv.aiModel,
    judgment,
  });
  logger.info(
    {
      digestChars: digest.text.length,
      ...digest.levels,
      documents: judgment.documents.length,
      expected: judgment.expected.length,
    },
    "Forecast judged"
  );
  return judgment;
}

/** One judgment per scope at a time; asking again while one runs waits for it. */
function judgeOnce(scope: string, run: () => Promise<void>): Promise<void> {
  const { running, attemptedAt } = registry();
  const existing = running.get(scope);
  if (existing != null) return existing;
  attemptedAt.set(scope, Date.now());
  const promise = run().finally(() => running.delete(scope));
  running.set(scope, promise);
  return promise;
}

/**
 * Runs `run` as the judgment of `scope` once any already running for it is
 * over, whatever became of that one, so the nightly run decides for itself
 * whether a read's run left anything to do.
 */
async function judgeAfterRunning(scope: string, run: () => Promise<void>): Promise<void> {
  for (;;) {
    const existing = registry().running.get(scope);
    if (existing == null) return judgeOnce(scope, run);
    await existing.catch(() => undefined);
  }
}

/**
 * Whether a judgment is due: none, one a week old or more, or one made under an older prompt.
 * Entries recorded since do not count; each judgment reads the whole ledger and costs real money, so
 * a scope is judged once a week and the week's new entries wait for the next one.
 */
function isStale(latest: StoredJudgment | null, today: string): boolean {
  return (
    latest == null ||
    civilDaysBetween(latest.asOf, today) >= FORECAST_AI_JUDGE_EVERY_DAYS ||
    !isCurrentJudgmentVersion(latest.inputFingerprint)
  );
}

/**
 * Starts a judgment of `scope` as of today in the background when one is due
 * and none was asked for in the last half hour, so a failing provider is
 * not asked on every read. The read goes on with what it has.
 */
export function refreshJudgmentInBackground(input: {
  scope: string;
  bookId: string | undefined;
  history: ForecastHistory;
  today: string;
  latest: StoredJudgment | null;
  language: string | undefined;
}): void {
  const { scope, today, latest } = input;
  if (!isStale(latest, today)) return;
  const last = Math.max(registry().attemptedAt.get(scope) ?? 0, latest?.createdAt.getTime() ?? 0);
  if (Date.now() - last < FORECAST_AI_REFRESH_MINUTES * MINUTE_MS) return;
  judgeOnce(scope, () => judge({ ...input, asOf: today }).then(() => undefined)).catch(
    (error: unknown) => {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Forecast judgment failed"
      );
    }
  );
}

/**
 * The nightly judgment of every book together, when one is due. A failure
 * fails the step; the next night, or the next read, asks again.
 */
export async function judgeForecasts(): Promise<void> {
  const settings = await getLedgerSettings();
  if (settings == null) return;
  const today = ledgerToday(settings.timeZone);
  const scope = "all";
  const history = await readForecastHistory({
    from: addCivilDays(today, -(FORECAST_HISTORY_DAYS - 1)),
    to: today,
  });
  if (history.rows.length === 0) return;

  await judgeAfterRunning(scope, async () => {
    const latest = await latestJudgment(scope, {
      from: addCivilDays(today, -(FORECAST_AI_JUDGE_EVERY_DAYS - 1)),
      to: today,
    });
    if (isStale(latest, today)) {
      await judge({
        scope,
        bookId: undefined,
        history,
        asOf: today,
        language: settings.aiLanguage,
      });
    }
  });
}
