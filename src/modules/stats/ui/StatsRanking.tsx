"use client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { EmptyState } from "@/components/EmptyState";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { abs, compare } from "@/lib/money/decimal";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { calendarCopy } from "@/copy/controls";
import { statsTabCopy } from "@/copy/stats";

/** Past this many, the tail is folded away: a ranking is read from the top. */
const COLLAPSED_LENGTH = 6;

interface CategoryStat {
  id: string | null;
  /** Null for the entries without a category. */
  name: string | null;
  icon: string | null;
  totalConverted: string;
  /** Share of the period's spending; zero for a category that nets out at or below nothing. */
  percent: number;
  count: number;
  /** The change from the comparison period's same days. */
  trend: { amount: string };
}

interface StatsRankingProps {
  data: CategoryStat[];
  isLoading?: boolean;
  currencySymbol?: string;
  /** Whether each row says how it moved; off when there is nothing to compare with. */
  showChange?: boolean;
  onCategoryClick?: (categoryId: string) => void;
}

export function StatsRanking({
  data,
  isLoading,
  currencySymbol = "CNY",
  showChange = false,
  onCategoryClick,
}: StatsRankingProps) {
  const locale = DISPLAY_LOCALE;
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <StatsPanel title={statsTabCopy.expenseRanking}>
        <div className="space-y-5" role="status" aria-busy="true">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface2/50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-24 animate-pulse rounded bg-surface2/50" />
                <div className="h-1.5 w-full animate-pulse rounded-full bg-surface2/50" />
              </div>
              <div className="h-4 w-20 animate-pulse rounded bg-surface2/50" />
            </div>
          ))}
        </div>
      </StatsPanel>
    );
  }

  if (data.length === 0) {
    return (
      <StatsPanel title={statsTabCopy.expenseRanking}>
        <EmptyState title={statsTabCopy.noStats} description={statsTabCopy.noStatsDesc} />
      </StatsPanel>
    );
  }

  const visible = expanded ? data : data.slice(0, COLLAPSED_LENGTH);
  const hidden = data.length - visible.length;

  return (
    <StatsPanel title={statsTabCopy.expenseRanking}>
      <div className="space-y-4">
        {visible.map((category) => {
          const displayName = category.name ?? statsTabCopy.uncategorized;
          // A refunded category has no share of what was spent. It keeps its
          // amount and its place in the order; only the bar has nothing to say.
          const hasShare = compare(category.totalConverted, "0") > 0;
          const amount = formatCurrencyAmount(category.totalConverted, currencySymbol, locale);
          const share = `${category.percent.toFixed(0)}%`;
          // Whole units: the line is about how far the category moved, not its cents.
          // Less than half a unit would read as "↑¥0", so it counts as no change.
          const change =
            compare(abs(category.trend.amount), "0.5") < 0
              ? 0
              : compare(category.trend.amount, "0");
          const changeAmount = formatCurrencyAmount(
            abs(category.trend.amount),
            currencySymbol,
            locale,
            { minimumFractionDigits: 0, maximumFractionDigits: 0 }
          );
          const changeText =
            !showChange || change === 0
              ? null
              : change > 0
                ? statsTabCopy.rankingMore({ amount: changeAmount })
                : statsTabCopy.rankingLess({ amount: changeAmount });

          return (
            <button
              type="button"
              key={category.id ?? "__uncategorized__"}
              disabled={onCategoryClick == null}
              aria-label={[displayName, amount, hasShare ? share : statsTabCopy.noShare, changeText]
                .filter((part) => part != null)
                .join(", ")}
              className={cn(
                "group grid w-full items-center gap-3 text-left",
                onCategoryClick != null
                  ? "grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem]"
                  : "grid-cols-[2.5rem_minmax(0,1fr)_auto]",
                onCategoryClick != null &&
                  "-mx-2 cursor-pointer rounded-lg px-2 py-1 transition-colors hover:bg-surface2/50"
              )}
              onClick={() => onCategoryClick?.(category.id ?? "__uncategorized__")}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface2 transition-colors group-hover:bg-primary/10">
                <CategoryIcon
                  iconName={category.icon}
                  className="h-5 w-5 text-text/80 transition-colors group-hover:text-primary"
                />
              </span>

              <span className="min-w-0 space-y-1.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={textRoleClassName("bodyStrong", "truncate")}>{displayName}</span>
                  <span className={textRoleClassName("meta", "shrink-0 tabular-nums")}>
                    {calendarCopy.count({ count: category.count })}
                  </span>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-surface2">
                  <span
                    className="block h-full origin-left rounded-full bg-primary transition-transform duration-[var(--motion-expand)] ease-[var(--motion-enter)]"
                    style={{
                      transform: `scaleX(${hasShare ? Math.max(0, Math.min(100, category.percent)) / 100 : 0})`,
                    }}
                  />
                </span>
              </span>

              <span className="shrink-0 text-right">
                <AmountText variant="item" className="block">
                  {amount}
                </AmountText>
                <span className={textRoleClassName("meta", "block tabular-nums")}>
                  {hasShare ? share : "—"}
                </span>
                {changeText != null ? (
                  <span
                    className={textRoleClassName(
                      "meta",
                      cn(
                        "block whitespace-nowrap tabular-nums",
                        change > 0 ? "text-destructive" : "text-primary"
                      )
                    )}
                  >
                    {changeText}
                  </span>
                ) : null}
              </span>
              {/* Says the row opens something: the category's entries. */}
              {onCategoryClick != null ? (
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>

      {data.length > COLLAPSED_LENGTH ? (
        <Button variant="ghost" className="w-full" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? statsTabCopy.showFewerCategories
            : statsTabCopy.showAllCategories({ count: hidden })}
        </Button>
      ) : null}
    </StatsPanel>
  );
}
