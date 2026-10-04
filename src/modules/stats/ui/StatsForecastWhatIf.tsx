"use client";
import { useMemo, useState } from "react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { formatCurrencyAmount } from "@/lib/format/currency";
import type { ForecastDto } from "@/modules/forecast/contracts";
import { whatIfOutcome } from "@/modules/forecast/domain/what-if";
import { forecastCopy, statsTabCopy } from "@/copy/stats";

/** The largest categories get a slider; the rest are left as they are. */
const SLIDERS = 4;
/** Half as much again or half as little, in steps of a tenth. */
const LIMIT_PERCENT = 50;
const STEP_PERCENT = 10;

interface StatsForecastWhatIfProps {
  forecast: ForecastDto;
  currencySymbol: string;
  /** What the period is set against, e.g. 上月; null leaves the comparison out. */
  periodLabel: string | null;
}

/**
 * "What if the rest of the period went differently": a slider per large
 * category scales its simulated paths, and the paths are added back up for the
 * new middle outcome, spread and chance of passing the previous period. All in
 * the browser, from the paths the forecast came with.
 */
export function StatsForecastWhatIf({
  forecast,
  currencySymbol,
  periodLabel,
}: StatsForecastWhatIfProps) {
  const [percents, setPercents] = useState<Record<string, number>>({});
  const sliders = forecast.categories
    .filter((category) => category.samples.length > 0)
    .slice(0, SLIDERS);
  const outcome = useMemo(
    () =>
      whatIfOutcome({
        spent: Number(forecast.spent),
        categories: forecast.categories.map((category) => ({
          samples: category.samples,
          factor: 1 + (percents[keyOf(category.id)] ?? 0) / 100,
        })),
        previousTotal:
          forecast.exceedPrevious == null ? null : Number(forecast.exceedPrevious.total),
      }),
    [forecast, percents]
  );
  if (sliders.length === 0 || outcome == null) return null;

  const money = (amount: number) =>
    formatCurrencyAmount(amount, currencySymbol, DISPLAY_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const changed = Object.values(percents).some((percent) => percent !== 0);

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className={textRoleClassName("bodyStrong")}>{forecastCopy.whatIfTitle}</p>
        {changed ? (
          <Button variant="ghost" size="sm" onClick={() => setPercents({})}>
            {forecastCopy.whatIfReset}
          </Button>
        ) : null}
      </div>
      {sliders.map((category) => {
        const key = keyOf(category.id);
        const percent = percents[key] ?? 0;
        const name = category.name ?? statsTabCopy.uncategorized;
        const label = forecastCopy.whatIfCategory({ category: name, percent: changeOf(percent) });
        return (
          <label key={key} className="grid grid-cols-[minmax(0,7rem)_1fr_4rem] items-center gap-3">
            <span className={textRoleClassName("meta", "truncate")}>{name}</span>
            <input
              type="range"
              min={-LIMIT_PERCENT}
              max={LIMIT_PERCENT}
              step={STEP_PERCENT}
              value={percent}
              aria-label={label}
              aria-valuetext={changeOf(percent)}
              className="w-full accent-primary"
              onChange={(event) =>
                setPercents((current) => ({ ...current, [key]: Number(event.target.value) }))
              }
            />
            <span className={textRoleClassName("meta", "text-right tabular-nums")}>
              {changeOf(percent)}
            </span>
          </label>
        );
      })}
      <p className={textRoleClassName("bodyMuted")} aria-live="polite">
        {forecastCopy.whatIfOutcome({
          amount: money(outcome.p50),
          low: money(outcome.p10),
          high: money(outcome.p90),
        })}
        {outcome.exceedPrevious != null && periodLabel != null
          ? `；${forecastCopy.whatIfExceed({
              period: periodLabel,
              percent: Math.round(outcome.exceedPrevious * 100),
            })}`
          : null}
      </p>
    </div>
  );
}

function keyOf(id: string | null): string {
  return id ?? "__uncategorized__";
}

function changeOf(percent: number): string {
  if (percent === 0) return forecastCopy.whatIfUnchanged;
  return percent > 0
    ? forecastCopy.whatIfMore({ percent })
    : forecastCopy.whatIfLess({ percent: -percent });
}
