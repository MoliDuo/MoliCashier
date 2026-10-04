import "server-only";
import { z } from "zod";
import { AI_LANGUAGES } from "@/config/languages";
import { generateStructured } from "@/lib/ai/structured";
import type { ForecastCommentaryDto, ForecastDto } from "@/modules/forecast/contracts";
import { getPeriodForecast } from "./get-forecast";

const commentarySchema = z.object({
  sentences: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
});

/** How many of the largest categories the model hears about. */
const CATEGORIES = 6;

/**
 * The forecast as the model is told it: totals and categories only. No entry,
 * merchant, bill name or note leaves the server, and every figure is one the
 * page already shows — the model words them, it does not work them out.
 */
function summaryOf(forecast: ForecastDto) {
  return {
    currency: forecast.currency,
    today: forecast.asOf,
    periodEnd: forecast.periodEnd,
    spentSoFar: forecast.spent,
    expectedTotal: forecast.total.p50,
    likelyRange: [forecast.total.p10, forecast.total.p90],
    previousPeriodTotal: forecast.exceedPrevious?.total ?? null,
    chanceOfExceedingPreviousPercent:
      forecast.exceedPrevious == null
        ? null
        : Math.round(forecast.exceedPrevious.probability * 100),
    categories: forecast.categories.slice(0, CATEGORIES).map((category) => ({
      name: category.name ?? "Uncategorized",
      spentSoFar: category.spent,
      expected: category.forecast.p50,
      likelyRange: [category.forecast.p10, category.forecast.p90],
    })),
    lifeChange:
      forecast.lifeChange == null
        ? null
        : {
            since: forecast.lifeChange.date,
            dailyBefore: forecast.lifeChange.dailyBefore,
            dailySince: forecast.lifeChange.dailyAfter,
          },
    recurringBillsStillToCome: forecast.upcoming.length,
    unusualDays: forecast.anomalies.map((anomaly) => ({
      date: anomaly.date,
      category: anomaly.name ?? "Uncategorized",
    })),
    backtestErrorPercent:
      forecast.model?.accuracy == null ? null : Math.round(forecast.model.accuracy.error * 100),
  };
}

/**
 * Two or three sentences on where the period is heading, written by the model
 * from the forecast's own figures. Asked for by a button and never stored;
 * null when the period has no forecast.
 */
export async function getForecastCommentary(
  input: unknown,
  settings: { timeZone: string; aiLanguage: string }
): Promise<ForecastCommentaryDto | null> {
  const forecast = await getPeriodForecast(input, settings.timeZone);
  if (forecast == null) return null;
  const language =
    AI_LANGUAGES.find((candidate) => candidate.value === settings.aiLanguage)?.label ??
    settings.aiLanguage;
  const reply = await generateStructured({
    task: "forecast-commentary",
    schema: commentarySchema,
    system: `You comment on a household's spending forecast for the current period in a personal bookkeeping app.
Return JSON only: {"sentences": ["...", "..."]} with two or three short sentences.
Use only the figures given, exactly as given, with the currency; never calculate, round or invent a figure.
Say where the period is heading and what drives it; mention a change in the way of spending, a likely overrun of the previous period, or unusual days only when they are given. Be plain and kind, never preachy.
Write in ${language} (${settings.aiLanguage}).`,
    messages: [{ role: "user", content: JSON.stringify(summaryOf(forecast)) }],
    maxTokens: 400,
    temperature: 0.4,
  });
  return { asOf: forecast.asOf, sentences: reply.sentences };
}
