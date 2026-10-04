"use client";
import { textRoleClassName } from "@/components/typography";
import { formatCivilDate } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import type { ForecastPhaseDto } from "@/modules/forecast/contracts";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { forecastCopy } from "@/copy/stats";

interface StatsLifePhasesProps {
  phases: readonly ForecastPhaseDto[];
  currencySymbol: string;
}

/**
 * The stretches of life the AI split the ledger into, newest first, each with
 * its days and what an everyday day cost in it. The current one leads.
 */
export function StatsLifePhases({ phases, currencySymbol }: StatsLifePhasesProps) {
  const locale = DISPLAY_LOCALE;
  if (phases.length === 0) return null;
  const date = (day: string) =>
    formatCivilDate(day, locale, { year: "numeric", month: "numeric", day: "numeric" });

  return (
    <StatsPanel title={forecastCopy.phasesTitle}>
      <ol className="space-y-2">
        {[...phases].reverse().map((phase, index) => {
          const current = index === 0;
          return (
            <li
              key={phase.from}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded-lg px-2 py-1.5",
                current && "bg-primary/5"
              )}
            >
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className={textRoleClassName("bodyStrong", "truncate")}>{phase.label}</span>
                  {current ? (
                    <span className={textRoleClassName("meta", "shrink-0 text-primary")}>
                      {forecastCopy.phaseCurrent}
                    </span>
                  ) : null}
                </span>
                <span className={textRoleClassName("meta", "block tabular-nums")}>
                  {current
                    ? forecastCopy.phaseSince({ from: date(phase.from) })
                    : forecastCopy.phaseRange({ from: date(phase.from), to: date(phase.to) })}
                </span>
              </span>
              {phase.daily != null ? (
                <span className={textRoleClassName("meta", "shrink-0 tabular-nums")}>
                  {forecastCopy.phaseDaily({
                    amount: formatCurrencyAmount(phase.daily, currencySymbol, locale, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }),
                  })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </StatsPanel>
  );
}
