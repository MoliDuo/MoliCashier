import "server-only";
import {
  FORECAST_AI_ACCURACY_HORIZON_DAYS,
  FORECAST_AI_AMOUNT_CAP_MULTIPLE,
  FORECAST_AI_BACKFILL_WEEKS,
  FORECAST_AI_EXPECTED_DAYS,
  FORECAST_AI_INPUT_MAX_CHARS,
  FORECAST_AI_INPUT_TEXT_CHARS,
  FORECAST_AI_MAX_ATTEMPTS,
  FORECAST_AI_MAX_TOKENS,
  FORECAST_AI_REASONING_EFFORT,
  FORECAST_AI_REFRESH_MINUTES,
  FORECAST_AI_RETENTION_DAYS,
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
  scorableJudgments,
  scoreJudgment,
  summarizeScores,
  type JudgmentAccuracy,
  type JudgmentScore,
} from "@/modules/forecast/domain/judgment/accuracy";
import {
  buildJudgmentDigest,
  type DigestReference,
} from "@/modules/forecast/domain/judgment/digest";
import { boundJudgment } from "@/modules/forecast/domain/judgment/bounds";
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
import { addCivilDays, calendarRangeOf } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { readForecastHistory, type ForecastHistory } from "./forecast-history";
import { readJudgmentLedger } from "./judgment-history";
import { judgedDays, judgmentsSince, saveJudgment, type StoredJudgment } from "./judgments";

const TEMPERATURE = 0.2;
const MINUTE_MS = 60_000;

// Like the trained models, the bookkeeping of runs lives on `globalThis`: the nightly step runs from
// instrumentation and the page's reads from route bundles. The judgments themselves are in the database.

interface Registry {
  running: Map<string, Promise<void>>;
  attemptedAt: Map<string, number>;
  accuracy: Map<string, { today: string; value: JudgmentAccuracy | null }>;
  scoring: Map<string, Promise<void>>;
}

const REGISTRY_KEY = Symbol.for("cashier.forecast.judgments");

function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (holder[REGISTRY_KEY] ??= {
    running: new Map(),
    attemptedAt: new Map(),
    accuracy: new Map(),
    scoring: new Map(),
  });
}

/** The statistical model's settings for the reference the AI is handed and for scoring: fewer paths than the page. */
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
  backfilled: boolean;
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
    earliest: digest.earliest ?? asOf,
    asOf,
    expectedDays: FORECAST_AI_EXPECTED_DAYS,
  });
  await saveJudgment({
    scope,
    asOf,
    inputFingerprint: historyFingerprint(history.rows, asOf),
    model: runtimeEnv.aiModel,
    backfilled: input.backfilled,
    judgment,
  });
  logger.info(
    {
      backfilled: input.backfilled,
      digestChars: digest.text.length,
      ...digest.levels,
      phases: judgment.phases.length,
      documents: judgment.documents.length,
      expected: judgment.expected.length,
      categories: judgment.categories.length,
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
 * over, whatever became of that one. The nightly run has more to do than a
 * read's judgment of today — the backfill — so waiting on a read's run and
 * calling it done would skip the backfill until the next night.
 */
async function judgeAfterRunning(scope: string, run: () => Promise<void>): Promise<void> {
  for (;;) {
    const existing = registry().running.get(scope);
    if (existing == null) return judgeOnce(scope, run);
    await existing.catch(() => undefined);
  }
}

/**
 * Whether today still lacks a judgment: none, one of another day, or one made under an older prompt.
 * Entries recorded since do not count; each judgment reads the whole ledger and costs real money, so
 * a scope is judged once a day and the day's new entries wait for the next one.
 */
function isStale(latest: StoredJudgment | null, today: string): boolean {
  return (
    latest == null || latest.asOf !== today || !isCurrentJudgmentVersion(latest.inputFingerprint)
  );
}

/**
 * Starts today's judgment of `scope` in the background when there is none
 * yet and none was asked for in the last half hour, so a failing provider is
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
  judgeOnce(scope, async () => {
    await judge({ ...input, asOf: today, backfilled: false });
    registry().accuracy.delete(scope);
  }).catch((error: unknown) => {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Forecast judgment failed"
    );
  });
}

/**
 * How the AI's past judgments of `scope` did, if scored today; when not yet,
 * the scoring starts in the background for the next read and this answers
 * null.
 */
export function judgmentAccuracy(
  scope: string,
  rows: readonly HistoryRow[],
  today: string
): JudgmentAccuracy | null {
  const cached = registry().accuracy.get(scope);
  if (cached?.today === today) return cached.value;
  scoreInBackground(scope, rows, today);
  return null;
}

function scoreInBackground(scope: string, rows: readonly HistoryRow[], today: string): void {
  scoreScope(scope, rows, today).catch((error: unknown) => {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Forecast judgment scoring failed"
    );
  });
}

/** Scores the past judgments of `scope`, letting other work run between them. */
function scoreScope(scope: string, rows: readonly HistoryRow[], today: string): Promise<void> {
  const { scoring, accuracy } = registry();
  const existing = scoring.get(scope);
  if (existing != null) return existing;
  const run = (async () => {
    const judgments = scorableJudgments(
      await judgmentsSince(scope, addCivilDays(today, -FORECAST_AI_RETENTION_DAYS)),
      today,
      FORECAST_AI_ACCURACY_HORIZON_DAYS
    );
    const scores: JudgmentScore[] = [];
    for (const { asOf, judgment } of judgments) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      scores.push(
        scoreJudgment({
          asOf,
          // Scored as the page would have shown it: held to what had been seen by then.
          judgment: boundJudgment(judgment, rows, asOf, FORECAST_AI_AMOUNT_CAP_MULTIPLE),
          rows,
          horizon: FORECAST_AI_ACCURACY_HORIZON_DAYS,
          statistical: STATISTICAL,
        })
      );
    }
    const value = summarizeScores(scores, FORECAST_AI_ACCURACY_HORIZON_DAYS);
    accuracy.set(scope, { today, value });
    if (value != null) {
      logger.info(
        {
          origins: value.origins,
          error: Number(value.error.toFixed(3)),
          statisticalError: Number(value.statisticalError.toFixed(3)),
        },
        "Forecast judgments scored"
      );
    }
  })().finally(() => scoring.delete(scope));
  scoring.set(scope, run);
  return run;
}

/**
 * The nightly judgment of every book together: today's, unless today already
 * has one; then the Mondays of the last twelve weeks that were never judged,
 * each from only what was recorded by then, so the AI's record can be scored
 * from the first day; then the score. Mondays, not the days a whole number of
 * weeks before today, so the set moves only once a week and its new day was
 * judged when it was today: after the first night nothing is left to backfill.
 * A failure stops the run and fails the step; what was judged by then is kept.
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
  const earliest = history.rows.reduce(
    (first, row) => (row.date < first ? row.date : first),
    today
  );
  const base = { scope, bookId: undefined, history, language: settings.aiLanguage };

  await judgeAfterRunning(scope, async () => {
    const [latest] = await judgmentsSince(scope, today);
    if (isStale(latest ?? null, today)) {
      await judge({ ...base, asOf: today, backfilled: false });
    }
    const monday = calendarRangeOf("week", today).from;
    const pastDays = Array.from({ length: FORECAST_AI_BACKFILL_WEEKS }, (_, index) =>
      addCivilDays(monday, -7 * (index + 1))
    ).filter((day) => day > addCivilDays(earliest, FORECAST_MIN_HISTORY_DAYS));
    const judged = await judgedDays(scope, pastDays);
    for (const day of pastDays.filter((candidate) => !judged.has(candidate)).reverse()) {
      await judge({ ...base, asOf: day, backfilled: true });
    }
  });
  registry().accuracy.delete(scope);
  await scoreScope(scope, history.rows, today);
}
