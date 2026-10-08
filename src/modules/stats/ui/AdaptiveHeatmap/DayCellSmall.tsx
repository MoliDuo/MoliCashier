/**
 * Small Day Cell (12px) with tooltip
 * GitHub-style contribution cell
 */

"use client";
import { cn } from "@/lib/utils";
import { getHeatmapColor, formatCellAmount } from "../../lib/heatmap-colors";
import { formatRelativeDateLabel } from "@/lib/date-utils";
import { useLedgerTimeZone } from "@/components/providers/ledger-time-zone";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HeatmapLevel } from "../../types";
import { compare } from "@/lib/money/decimal";
import { calendarCopy } from "@/copy/controls";

interface DayCellSmallProps {
  date: string;
  amount: string;
  count: number;
  level: HeatmapLevel;
  onClick?: () => void;
  currency: string;
  locale: string;
}

export function DayCellSmall({
  date,
  amount,
  count,
  level,
  onClick,
  currency,
  locale,
}: DayCellSmallProps) {
  const timeZone = useLedgerTimeZone();
  const dateLabel = formatRelativeDateLabel(date, locale, timeZone);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${dateLabel}, ${count > 0 || compare(amount, "0") !== 0 ? `${calendarCopy.expense}: ${formatCellAmount(amount, currency, locale)}` : calendarCopy.noConsumption}`}
          onClick={onClick}
          className={cn(
            "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)]",
            "hover:ring-1 hover:ring-primary/50"
          )}
        >
          <span
            aria-hidden
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: getHeatmapColor(level) }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center">
        <div className="font-medium">{dateLabel}</div>
        {count > 0 || compare(amount, "0") !== 0 ? (
          <>
            <div>
              {calendarCopy.expense}: {formatCellAmount(amount, currency, locale)}
            </div>
            <div>{calendarCopy.count({ count })}</div>
          </>
        ) : (
          <div className="text-muted-foreground">{calendarCopy.noConsumption}</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
