"use client";
import { ChevronRight } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { textRoleClassName } from "@/components/typography";
import { formatCivilDate } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { StatsLargestEntryDto } from "@/modules/stats/contracts";
import { StatsPanel } from "./StatsPanel";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { statsTabCopy } from "@/copy/stats";

interface StatsLargestEntriesProps {
  entries: StatsLargestEntryDto[];
  currencySymbol: string;
  /** Opens the record an entry belongs to. */
  onOpen: (entry: StatsLargestEntryDto) => void;
  /** What the AI judged each record to be, by record id — 一次性, 每学期 — for the records it judged not everyday. */
  kinds?: ReadonlyMap<string, string>;
}

/**
 * The period's biggest entries. A total that looks high is usually two or three
 * purchases; naming them answers "where did it go" without a trip to 账目.
 * With the AI's judgment, a purchase that is not everyday spending says what it is.
 */
export function StatsLargestEntries({
  entries,
  currencySymbol,
  onOpen,
  kinds,
}: StatsLargestEntriesProps) {
  const locale = DISPLAY_LOCALE;
  if (entries.length === 0) return null;

  return (
    <StatsPanel title={statsTabCopy.largestEntries}>
      <ol className="space-y-1">
        {entries.map((entry) => {
          const amount = formatCurrencyAmount(entry.amount, currencySymbol, locale);
          const date = formatCivilDate(entry.date, locale, { month: "numeric", day: "numeric" });
          const original =
            entry.originalCurrency === currencySymbol
              ? null
              : formatCurrencyAmount(entry.originalAmount, entry.originalCurrency, locale);
          const category = entry.categoryName ?? statsTabCopy.uncategorized;
          const kind = kinds?.get(entry.sourceDocumentId) ?? null;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onOpen(entry)}
                aria-label={[entry.name, category, date, kind, amount, original]
                  .filter((part) => part != null)
                  .join(", ")}
                className="group -mx-2 grid w-[calc(100%+1rem)] grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface2/50"
              >
                <span className="flex size-10 items-center justify-center rounded-full bg-surface2 transition-colors group-hover:bg-primary/10">
                  <CategoryIcon
                    iconName={entry.categoryIcon}
                    className="size-5 text-text/80 transition-colors group-hover:text-primary"
                  />
                </span>
                <span className="min-w-0">
                  <span className={textRoleClassName("bodyStrong", "block truncate")}>
                    {entry.name}
                  </span>
                  <span className={textRoleClassName("meta", "block truncate")}>
                    {category} · {date}
                    {kind != null ? ` · ${kind}` : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <AmountText variant="item" className="block">
                    {amount}
                  </AmountText>
                  {original != null ? (
                    <span className={textRoleClassName("meta", "block tabular-nums")}>
                      {original}
                    </span>
                  ) : null}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ol>
    </StatsPanel>
  );
}
