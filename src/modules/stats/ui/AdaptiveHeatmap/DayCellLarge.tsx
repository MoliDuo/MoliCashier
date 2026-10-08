/**
 * Large Day Cell (40px)
 */

"use client";
import { textRoleClassName } from "@/components/typography";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getHeatmapColor, formatCellAmount } from "../../lib/heatmap-colors";
import { formatCompactAmount } from "@/lib/format/currency";
import { formatRelativeDateLabel } from "@/lib/date-utils";
import { useLedgerTimeZone } from "@/components/providers/ledger-time-zone";
import type { HeatmapLevel } from "../../types";
import { compare } from "@/lib/money/decimal";
import { calendarCopy } from "@/copy/controls";

interface DayCellLargeProps {
  date: string;
  dayNumber: number;
  amount: string;
  count?: number;
  level: HeatmapLevel;
  onClick?: () => void;
  currency: string;
  locale: string;
}

export function DayCellLarge({
  date,
  dayNumber,
  amount,
  count = 0,
  level,
  onClick,
  currency,
  locale,
}: DayCellLargeProps) {
  const timeZone = useLedgerTimeZone();
  const dateLabel = formatRelativeDateLabel(date, locale, timeZone);

  return (
    <div className="relative min-w-0 overflow-visible">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${dateLabel}, ${count > 0 || compare(amount, "0") !== 0 ? `${calendarCopy.expense}: ${formatCellAmount(amount, currency, locale)}` : calendarCopy.noConsumption}`}
            onClick={onClick}
            className={cn(
              "aspect-square w-full min-w-0 overflow-hidden rounded-lg transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)]",
              "flex flex-col items-center justify-center gap-0.5",
              "hover:ring-1 hover:ring-primary/40"
            )}
            style={{
              backgroundColor: getHeatmapColor(level),
              minHeight: "40px",
            }}
          >
            <span
              className={textRoleClassName(
                "meta",
                "max-w-full truncate px-0.5 font-normal tabular-nums"
              )}
              style={{ color: `var(--heatmap-text-${level >= 4 ? "high" : "low"})` }}
            >
              {dayNumber}
            </span>

            {count > 0 || compare(amount, "0") !== 0 ? (
              // The cell is about forty pixels wide on a phone. The currency
              // is already named above the grid, so the symbol only costs the
              // figure the room it needs to stay readable.
              <span
                className="max-w-full truncate px-0.5 text-micro font-semibold tabular-nums"
                style={{ color: `var(--heatmap-text-${level >= 4 ? "high" : "low"})` }}
              >
                {formatCompactAmount(amount, currency, locale)}
              </span>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          <div className="font-medium">{dateLabel}</div>
          {count > 0 || compare(amount, "0") !== 0 ? (
            <div>
              {calendarCopy.expense}: {formatCellAmount(amount, currency, locale)}
              {count > 0 ? ` · ${calendarCopy.count({ count })}` : null}
            </div>
          ) : (
            <div className="text-muted-foreground">{calendarCopy.noConsumption}</div>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
