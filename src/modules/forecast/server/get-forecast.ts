import "server-only";
import {
  FORECAST_AI_AMOUNT_CAP_MULTIPLE,
  FORECAST_AI_MAX_AGE_DAYS,
  FORECAST_CHANGE_DISCOUNT,
  FORECAST_HALF_LIFE_DAYS,
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_HISTORY_DAYS,
  FORECAST_SIMULATION_PATHS,
} from "@/config/tuning";
import { ValidationError } from "@/lib/errors";
import { forecastInputSchema } from "@/modules/forecast/contract-schemas";
import type { ForecastDto, ForecastRangeDto } from "@/modules/forecast/contracts";
import { forecastPeriod, type PeriodForecast } from "@/modules/forecast/domain/forecast";
import { prepareHistory, type PreparedHistory } from "@/modules/forecast/domain/history";
import {
  expectedCharges,
  judgedDocumentsIn,
  withExpectedCharges,
} from "@/modules/forecast/domain/judgment/apply";
import { boundJudgment } from "@/modules/forecast/domain/judgment/bounds";
import { seedOf } from "@/modules/forecast/domain/random";
import { UNCATEGORIZED_KEY } from "@/modules/forecast/domain/series";
import type { Quantiles } from "@/modules/forecast/domain/simulate";
import { addCivilDays, periodKey, resolveComparison } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { readForecastHistory, readHistoryMark, type ForecastHistory } from "./forecast-history";
import { refreshJudgmentInBackground } from "./judge-ledger";
import { latestJudgment } from "./judgments";
import { forecastScope } from "./scope";

function money(value: number): string {
  const fixed = value.toFixed(2);
  return fixed === "-0.00" ? "0.00" : fixed;
}

function rangeDto(quantiles: Quantiles): ForecastRangeDto {
  return { p10: money(quantiles.p10), p50: money(quantiles.p50), p90: money(quantiles.p90) };
}

/**
 * What a read of one scope's period worked out, kept for the reads after it:
 * the history, prepared with the judgment in use, and the statistical
 * forecast. The judgment is read afresh every time, since it changes in the
 * background, and is part of the key.
 */
interface MemoEntry {
  history: ForecastHistory;
  prepared: PreparedHistory | null;
  forecast: PeriodForecast | null;
}

/** The most reads remembered; a couple of people switching between books and periods need few. */
const MEMO_MAX_ENTRIES = 16;
const memo = new Map<string, MemoEntry>();

function remember(key: string, entry: MemoEntry): void {
  memo.delete(key);
  memo.set(key, entry);
  while (memo.size > MEMO_MAX_ENTRIES) memo.delete(memo.keys().next().value!);
}

/**
 * The forecast for 统计's period, or null when the period is not a calendar
 * period that is still running. The period is resolved here, from the
 * ledger's today, exactly as 统计's own read resolves it.
 *
 * When the AI analyst has judged the ledger in the last week or so, the
 * purchases it judged not everyday are left out of what the statistical model
 * learns from, and the charges it expects before the period ends are added on
 * their days. A judgment due again is asked for in the background.
 */
export async function getPeriodForecast(
  input: unknown,
  timeZone: string
): Promise<ForecastDto | null> {
  const parsed = forecastInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Validation failed", { issues: parsed.error.issues });
  }
  const { bookId, period } = parsed.data;
  const today = ledgerToday(timeZone);
  const window = resolveComparison(period, today);
  if (window.mode !== "same_period") return null;

  const scope = forecastScope(bookId);
  const latest = await latestJudgment(scope, {
    from: addCivilDays(today, -FORECAST_AI_MAX_AGE_DAYS),
    to: today,
  });
  // Read before the history, so a change landing in between is only ever remembered under the older mark.
  const memoKey = [
    scope,
    periodKey(period),
    today,
    await readHistoryMark(),
    latest == null ? "" : `${latest.asOf}@${latest.createdAt.getTime()}`,
  ].join("|");
  const remembered = memo.get(memoKey);
  const historyStart = addCivilDays(today, -(FORECAST_HISTORY_DAYS - 1));
  const history =
    remembered?.history ?? (await readForecastHistory({ from: historyStart, to: today }, bookId));
  const prepared =
    remembered == null
      ? prepareHistory(
          history.rows,
          today,
          FORECAST_MIN_HISTORY_DAYS,
          new Set(latest?.judgment.documents.map((document) => document.documentId))
        )
      : remembered.prepared;
  const forecast =
    remembered != null
      ? remembered.forecast
      : forecastPeriod({
          rows: history.rows,
          today,
          period: { from: window.range.from, end: window.periodEnd },
          prepared,
          options: {
            halfLifeDays: FORECAST_HALF_LIFE_DAYS,
            changeDiscount: FORECAST_CHANGE_DISCOUNT,
            paths: FORECAST_SIMULATION_PATHS,
            seed: seedOf(`${today}:${bookId ?? "all"}:${periodKey(period)}`),
            minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
          },
        });
  remember(memoKey, { history, prepared, forecast });
  // Too little history: nothing to forecast, and nothing for the analyst to judge.
  if (prepared == null) return null;

  const settings = await getLedgerSettings();
  // The judgment is of the ledger, not of this period, so it is kept current
  // even on a period's last day, when there is nothing left to forecast.
  refreshJudgmentInBackground({
    scope,
    bookId,
    history,
    today,
    latest,
    language: settings?.aiLanguage,
  });
  if (forecast == null) return null;

  const judgment =
    latest == null
      ? null
      : boundJudgment(latest.judgment, history.rows, today, FORECAST_AI_AMOUNT_CAP_MULTIPLE);
  const shown =
    judgment == null || latest == null
      ? forecast
      : withExpectedCharges(
          forecast,
          expectedCharges({
            judgment,
            asOf: latest.asOf,
            rows: history.rows,
            forecast,
            today,
            end: window.periodEnd,
          }),
          today
        );

  return {
    asOf: today,
    periodEnd: window.periodEnd,
    currency: history.mainCurrency,
    spent: shown.spent,
    total: rangeDto(shown.total),
    running: shown.running.map(rangeDto),
    categories: shown.categories.map((category) => ({
      ...categoryOf(category.key),
      spent: category.spent,
      forecast: rangeDto(category.forecast),
    })),
    lifeChange:
      shown.lifeChange == null
        ? null
        : {
            date: shown.lifeChange.date,
            dailyBefore: money(shown.lifeChange.dailyBefore),
            dailyAfter: money(shown.lifeChange.dailyAfter),
          },
    anomalies: shown.anomalies.map((anomaly) => ({
      date: anomaly.date,
      ...categoryOf(anomaly.key),
      amount: money(anomaly.amount),
      typical: money(anomaly.typical),
    })),
    judgment:
      latest == null
        ? null
        : {
            asOf: latest.asOf,
            documents: judgedDocumentsIn(latest.judgment, history.rows, window.range.from, today),
          },
  };

  function categoryOf(key: string) {
    const meta = key === UNCATEGORIZED_KEY ? undefined : history.categories.get(key);
    return {
      id: key === UNCATEGORIZED_KEY ? null : key,
      name: meta?.name ?? null,
      icon: meta?.icon ?? null,
    };
  }
}
