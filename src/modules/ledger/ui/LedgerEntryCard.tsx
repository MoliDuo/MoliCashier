import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { EntryCardShell } from "@/components/entry-card-shell";
import { SelectableCardSurface } from "@/components/selectable-card-surface";
import { CategoryIcon } from "@/components/CategoryIcon";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { AmountDisplay } from "@/modules/currency/ui/AmountDisplay";

import { memo } from "react";
import { ProcessingSweep } from "@/modules/source-document/ui/processing-sweep";
import { CategoryAssignmentEntryLabel } from "./CategoryAssignmentEntryLabel";
import { useCategoryAssignmentEntryState } from "./category-assignment-entry-states";
import { commonCopy } from "@/copy/common";

interface LedgerEntryCardProps {
  ledgerEntry: LedgerEntryDto;
  onView?: (entry: LedgerEntryDto) => void;
  className?: string;
  mainCurrency?: string;
  selectionMode?: boolean;
  isSelected?: boolean;
  selectionDisabled?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const LedgerEntryCard = memo(function LedgerEntryCard({
  ledgerEntry,
  onView,
  className,
  mainCurrency = "CNY",
  selectionMode = false,
  isSelected = false,
  selectionDisabled = false,
  onToggleSelect,
}: LedgerEntryCardProps) {
  const assignmentState = useCategoryAssignmentEntryState(ledgerEntry.id);
  return (
    <SelectableCardSurface
      selectionMode={selectionMode}
      selected={isSelected}
      disabled={selectionDisabled}
      selectionLabel={commonCopy.selectItem({ item: ledgerEntry.itemName })}
      onToggleSelection={() => onToggleSelect?.(ledgerEntry.id)}
    >
      <EntryCardShell
        selected={selectionMode && isSelected}
        interactive={onView != null || selectionMode}
        tone={
          assignmentState === "pending"
            ? "busy"
            : assignmentState === "failed"
              ? "danger"
              : "default"
        }
        className={className}
        data-testid="ledger-entry-card-root"
        {...(!selectionMode && onView != null
          ? {
              role: "button",
              tabIndex: 0,
              onKeyDown: (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onView(ledgerEntry);
              },
            }
          : {})}
      >
        {assignmentState === "pending" ? <ProcessingSweep /> : null}
        {/* The same padding as the entry rows inside a source document, so a
            card here is exactly as tall as one of those rows — and its amounts
            line up with them, and with the toolbar's total above. Widening the
            inset at `sm` broke both. */}
        <div className="px-3 py-2">
          <div
            className={cn(onView != null && !selectionMode && "cursor-pointer")}
            onClick={(e) => {
              if (selectionMode) return;
              const target = e.target as HTMLElement;
              if (target.closest("button") || target.closest("select") || target.closest("input")) {
                return;
              }
              onView?.(ledgerEntry);
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3 mr-3">
                <div className="h-8 w-8 flex items-center justify-center bg-surface2 rounded-full text-text shrink-0">
                  <CategoryIcon
                    {...(ledgerEntry.category?.icon !== undefined
                      ? { iconName: ledgerEntry.category.icon }
                      : {})}
                    className="w-4 h-4"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={textRoleClassName("bodyStrong", "truncate")}>
                    {ledgerEntry.itemName}
                  </p>
                  <div className="flex min-w-0 items-center gap-1.5 mt-0.5">
                    {assignmentState != null && (
                      <CategoryAssignmentEntryLabel state={assignmentState} />
                    )}
                    {ledgerEntry.category && (
                      <div
                        className={textRoleClassName(
                          "meta",
                          "flex items-center gap-1.5 min-w-0 flex-1"
                        )}
                      >
                        <span className="min-w-0 truncate">{ledgerEntry.category.name}</span>
                        {ledgerEntry.description != null && ledgerEntry.description !== "" && (
                          <span className="hidden sm:contents">
                            <span className="text-muted-foreground/60 ml-0.5 shrink-0">·</span>
                            <span className={textRoleClassName("provisional", "truncate flex-1")}>
                              {ledgerEntry.description}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <AmountDisplay
                amount={ledgerEntry.amount}
                currency={ledgerEntry.currency}
                mainCurrency={mainCurrency}
                date={ledgerEntry.sourceDocument?.documentDate ?? ledgerEntry.createdAt}
                persistedConvertedAmount={ledgerEntry.convertedAmount}
                variant="item"
                className="shrink-0"
              />
            </div>
          </div>
        </div>
      </EntryCardShell>
    </SelectableCardSurface>
  );
});
