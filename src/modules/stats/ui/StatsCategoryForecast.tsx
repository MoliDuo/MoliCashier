"use client";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type {
  ForecastCategoryDto,
  ForecastDto,
  ForecastJudgmentDto,
} from "@/modules/forecast/contracts";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { forecastCopy, statsTabCopy } from "@/copy/stats";

/** Past this many, the tail is folded away, as the ranking folds its own. */
const COLLAPSED_LENGTH = 6;

interface StatsCategoryForecastProps {
  forecast: ForecastDto;
  currencySymbol: string;
  onCategoryClick?: (categoryId: string) => void;
}

/**
 * Where each category is heading by the end of the period: what it has cost
 * so far, the middle outcome, and the spread that four in five outcomes fall
 * in. All rows share one scale, so a long bar is a big category. With the
 * AI's judgment, each category also shows which way it is heading.
 */
export function StatsCategoryForecast({
  forecast,
  currencySymbol,
  onCategoryClick,
}: StatsCategoryForecastProps) {
  const locale = DISPLAY_LOCALE;
  const [expanded, setExpanded] = useState(false);
  if (forecast.categories.length === 0) return null;

  const money = (amount: string) => formatCurrencyAmount(amount, currencySymbol, locale);
  const visible = expanded ? forecast.categories : forecast.categories.slice(0, COLLAPSED_LENGTH);
  const hidden = forecast.categories.length - visible.length;
  const scaleMax = Math.max(
    ...forecast.categories.map((category) =>
      Math.max(Number(category.forecast.p90), Number(category.spent))
    ),
    0
  );
  const share = (amount: string) =>
    scaleMax <= 0 ? 0 : Math.min(100, Math.max(0, (Number(amount) / scaleMax) * 100));

  return (
    <StatsPanel title={forecastCopy.title}>
      <div className="space-y-4">
        {visible.map((category) => {
          const name = category.name ?? statsTabCopy.uncategorized;
          const expected = forecastCopy.expected({ amount: money(category.forecast.p50) });
          const range = forecastCopy.range({
            low: money(category.forecast.p10),
            high: money(category.forecast.p90),
          });
          const spent = forecastCopy.spent({ amount: money(category.spent) });
          const trend = trendOf(category);
          const low = share(category.forecast.p10);
          const high = share(category.forecast.p90);
          return (
            <button
              type="button"
              key={category.id ?? "__uncategorized__"}
              disabled={onCategoryClick == null}
              aria-label={[name, trend?.label, expected, range, spent]
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
                {/* On a phone the spent line drops under the name: beside it, the name
                    was squeezed to nothing between the trend and the amount. */}
                <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className={textRoleClassName("bodyStrong", "truncate")}>{name}</span>
                    {trend != null ? (
                      <span
                        aria-hidden="true"
                        className={textRoleClassName(
                          "meta",
                          cn(
                            "inline-flex shrink-0 items-center gap-0.5 self-center tabular-nums",
                            trend.direction === "rising" && "text-danger",
                            trend.direction === "falling" && "text-success"
                          )
                        )}
                      >
                        <trend.Icon className="size-3.5" />
                        {trend.text}
                      </span>
                    ) : null}
                  </span>
                  <span className={textRoleClassName("meta", "shrink-0 tabular-nums")}>
                    {spent}
                  </span>
                </span>
                {/* Spent so far as the solid bar, the spread as the band, the middle as the tick. */}
                <span
                  aria-hidden="true"
                  className="relative block h-1.5 overflow-hidden rounded-full bg-surface2"
                >
                  <span
                    className="absolute inset-y-0 rounded-full bg-primary/20"
                    style={{ left: `${low}%`, width: `${Math.max(0, high - low)}%` }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${share(category.spent)}%` }}
                  />
                  <span
                    className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
                    style={{ left: `${share(category.forecast.p50)}%` }}
                  />
                </span>
              </span>

              <span className="shrink-0 text-right">
                <AmountText variant="item" className="block">
                  {money(category.forecast.p50)}
                </AmountText>
                <span className={textRoleClassName("meta", "block whitespace-nowrap tabular-nums")}>
                  {range}
                </span>
              </span>
              {onCategoryClick != null ? (
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              ) : null}
            </button>
          );
        })}
      </div>

      {forecast.categories.length > COLLAPSED_LENGTH ? (
        <Button variant="ghost" className="w-full" onClick={() => setExpanded(!expanded)}>
          {expanded
            ? statsTabCopy.showFewerCategories
            : statsTabCopy.showAllCategories({ count: hidden })}
        </Button>
      ) : null}
    </StatsPanel>
  );
}

/** How often something comes back, in words. */
export function cadenceName(
  cadence: NonNullable<ForecastJudgmentDto["documents"][number]["cadence"]>
): string {
  switch (cadence) {
    case "weekly":
      return forecastCopy.weekly;
    case "monthly":
      return forecastCopy.monthly;
    case "semester":
      return forecastCopy.semester;
    case "yearly":
      return forecastCopy.yearly;
    case "irregular":
      return forecastCopy.irregular;
  }
}

/** The arrow, the change and the words for a category's trend; null without a judgment. */
function trendOf(category: ForecastCategoryDto) {
  const trend = category.trend;
  if (trend == null) return null;
  const percent = trend.change == null ? null : Math.round(Math.abs(trend.change) * 100);
  switch (trend.direction) {
    case "rising":
      return {
        direction: trend.direction,
        Icon: ArrowUpRight,
        text: percent == null ? null : forecastCopy.trendRising({ percent }),
        label: forecastCopy.trendRisingLabel,
      };
    case "falling":
      return {
        direction: trend.direction,
        Icon: ArrowDownRight,
        text: percent == null ? null : forecastCopy.trendFalling({ percent }),
        label: forecastCopy.trendFallingLabel,
      };
    case "steady":
      return {
        direction: trend.direction,
        Icon: ArrowRight,
        text: null,
        label: forecastCopy.trendSteadyLabel,
      };
  }
}
