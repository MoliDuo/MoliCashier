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
import { applyJudgment } from "@/modules/forecast/domain/judgment/apply";
import { boundJudgment } from "@/modules/forecast/domain/judgment/bounds";
import { seedOf } from "@/modules/forecast/domain/random";
import { UNCATEGORIZED_KEY } from "@/modules/forecast/domain/series";
import type { Quantiles } from "@/modules/forecast/domain/simulate";
import type { TrainedForecast } from "@/modules/forecast/domain/training";
import { addCivilDays, periodKey, resolveComparison } from "@/modules/ledger/domain/period";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { readForecastHistory, readHistoryMark, type ForecastHistory } from "./forecast-history";
import { judgmentAccuracy, refreshJudgmentInBackground } from "./judge-ledger";
import { latestJudgment } from "./judgments";
import { currentTraining, forecastScope, trainScopeInBackground } from "./model-registry";

function money(value: number): string {
  const fixed = value.toFixed(2);
  return fixed === "-0.00" ? "0.00" : fixed;
}

function rangeDto(quantiles: Quantiles): ForecastRangeDto {
  return { p10: money(quantiles.p10), p50: money(quantiles.p50), p90: money(quantiles.p90) };
}

/**
 * What a read of one scope's period worked out, kept for the reads after it:
 * the history, prepared, and the statistical forecast with the trained model
 * it was played with. The judgment, its score and the model in use are read
 * afresh every time, since they change in the background; the forecast is
 * played again only when the model in use is not the one it was played with.
 */
interface MemoEntry {
  history: ForecastHistory;
  prepared: PreparedHistory | null;
  trained: TrainedForecast | null;
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
 * The read uses the scope's trained forecast — the half-life the nightly
 * contest chose and, if it earned a share, the network. Without one that is
 * current (none yet, too old, or trained before the latest change in the way
 * of spending) it answers from the statistical model with the default
 * half-life and starts training in the background for the next read.
 *
 * When the AI analyst has judged the ledger in the last couple of days, the
 * figures come from its judgment instead — every category's everyday day,
 * what it expects to come, the phases of life — with what was spent read
 * now. A judgment that no longer stands for the history is asked for again
 * in the background.
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

  const previous = { from: window.compareRange.from, to: window.previousWholeTo };
  const scope = forecastScope(bookId);
  // Read before the history, so a change landing in between is only ever remembered under the older mark.
  const memoKey = `${scope}|${periodKey(period)}|${today}|${await readHistoryMark()}`;
  const remembered = memo.get(memoKey);
  const historyStart = addCivilDays(today, -(FORECAST_HISTORY_DAYS - 1));
  const history =
    remembered?.history ??
    (await readForecastHistory(
      { from: previous.from < historyStart ? previous.from : historyStart, to: today },
      bookId
    ));
  const prepared =
    remembered == null
      ? prepareHistory(history.rows, today, FORECAST_MIN_HISTORY_DAYS)
      : remembered.prepared;
  const changeDate =
    prepared?.change == null ? null : addCivilDays(prepared.earliest, prepared.change.day);
  const trained = currentTraining(scope, today, changeDate);
  if (trained == null && prepared != null) trainScopeInBackground(scope, history.rows, today);
  const halfLifeDays = trained?.halfLifeDays ?? FORECAST_HALF_LIFE_DAYS;

  const forecast =
    remembered != null && remembered.trained === trained
      ? remembered.forecast
      : forecastPeriod({
          rows: history.rows,
          today,
          period: { from: window.range.from, end: window.periodEnd },
          previous,
          prepared,
          options: {
            halfLifeDays,
            changeDiscount: FORECAST_CHANGE_DISCOUNT,
            paths: FORECAST_SIMULATION_PATHS,
            seed: seedOf(`${today}:${bookId ?? "all"}:${periodKey(period)}`),
            minHistoryDays: FORECAST_MIN_HISTORY_DAYS,
            network: trained?.network ?? null,
            networkShare: trained?.networkShare ?? 0,
          },
        });
  remember(memoKey, { history, prepared, trained, forecast });
  // Too little history, or no days left: nothing to forecast, and nothing for the analyst to judge.
  if (prepared == null || forecast == null) return null;

  const [latest, settings] = await Promise.all([
    latestJudgment(scope, { from: addCivilDays(today, -FORECAST_AI_MAX_AGE_DAYS), to: today }),
    getLedgerSettings(),
  ]);
  refreshJudgmentInBackground({
    scope,
    bookId,
    history,
    today,
    latest,
    language: settings?.aiLanguage,
  });
  const judged =
    latest == null
      ? null
      : applyJudgment({
          judgment: boundJudgment(
            latest.judgment,
            history.rows,
            today,
            FORECAST_AI_AMOUNT_CAP_MULTIPLE
          ),
          rows: history.rows,
          today,
          period: { from: window.range.from, end: window.periodEnd },
        });

  const statistical: ForecastDto = {
    asOf: today,
    periodEnd: window.periodEnd,
    currency: history.mainCurrency,
    historyFrom: forecast.historyFrom,
    halfLifeDays,
    spent: forecast.spent,
    total: rangeDto(forecast.total),
    running: forecast.running.map(rangeDto),
    categories: forecast.categories.map((category) => ({
      ...categoryOf(category.key),
      spent: category.spent,
      forecast: rangeDto(category.forecast),
      trend: null,
    })),
    exceedPrevious: forecast.exceedPrevious,
    lifeChange:
      forecast.lifeChange == null
        ? null
        : {
            date: forecast.lifeChange.date,
            dailyBefore: money(forecast.lifeChange.dailyBefore),
            dailyAfter: money(forecast.lifeChange.dailyAfter),
          },
    largePurchaseFrom: forecast.largeFrom == null ? null : money(forecast.largeFrom),
    anomalies: forecast.anomalies.map((anomaly) => ({
      date: anomaly.date,
      ...categoryOf(anomaly.key),
      amount: money(anomaly.amount),
      typical: money(anomaly.typical),
    })),
    model:
      trained == null
        ? null
        : {
            trainedFor: trained.asOf,
            networkShare: Number(trained.networkShare.toFixed(2)),
            accuracy:
              trained.backtest == null
                ? null
                : {
                    origins: trained.backtest.origins,
                    horizonDays: trained.backtest.horizon,
                    error: Number(trained.backtest.ensemble.error.toFixed(3)),
                    statisticalError: Number(trained.backtest.statistical.error.toFixed(3)),
                    networkError:
                      trained.backtest.network == null
                        ? null
                        : Number(trained.backtest.network.error.toFixed(3)),
                    typicalDayError: Number(trained.backtest.typicalDay.error.toFixed(3)),
                  },
          },
    judgment: null,
  };
  if (judged == null || latest == null) return statistical;
  const accuracy = judgmentAccuracy(scope, history.rows, today);
  // The analyst's past judgments, scored, did worse than the statistical model on the same days.
  if (accuracy != null && accuracy.error > accuracy.statisticalError) return statistical;

  const phases = judged.phases;
  const current = phases.at(-1);
  const before = phases.at(-2);
  return {
    ...statistical,
    spent: judged.spent,
    total: rangeDto(judged.total),
    running: judged.running.map(rangeDto),
    categories: judged.categories.map((category) => ({
      ...categoryOf(category.key),
      spent: category.spent,
      forecast: rangeDto(category.forecast),
      trend:
        category.trend == null
          ? null
          : {
              direction: category.trend.direction,
              change:
                category.trend.change == null ? null : Number(category.trend.change.toFixed(3)),
            },
    })),
    // The current phase's first day stands where the detected change stood, on the chart too.
    lifeChange:
      current == null || before == null
        ? null
        : {
            date: current.from,
            dailyBefore: money(before.daily ?? 0),
            dailyAfter: money(current.daily ?? 0),
          },
    largePurchaseFrom: null,
    judgment: {
      asOf: latest.asOf,
      phases: phases.map((phase) => ({
        from: phase.from,
        to: phase.to,
        label: phase.label,
        daily: phase.daily == null ? null : money(phase.daily),
      })),
      documents: judged.documents,
      accuracy:
        accuracy == null
          ? null
          : {
              origins: accuracy.origins,
              horizonDays: accuracy.horizonDays,
              error: Number(accuracy.error.toFixed(3)),
              statisticalError: Number(accuracy.statisticalError.toFixed(3)),
            },
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
