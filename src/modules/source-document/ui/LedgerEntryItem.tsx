import { memo } from "react";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import { CategoryIcon } from "@/components/CategoryIcon";
import { textRoleClassName } from "@/components/typography";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { AmountDisplay } from "@/modules/currency/ui/AmountDisplay";
import { CategoryAssignmentEntryLabel } from "@/modules/ledger/ui/CategoryAssignmentEntryLabel";
import { useCategoryAssignmentEntryState } from "@/modules/ledger/ui/category-assignment-entry-states";

/**
 * Variant styles for different source document states.
 * The source document container determines the variant, and entries inherit the theme.
 */
const itemVariants = cva(
  // Square and full-bleed inside the card that holds it, so the row reads as a
  // row of that card rather than as a small card of its own.
  "flex w-full items-center justify-between px-3 py-2 text-left transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)] disabled:cursor-default",
  {
    variants: {
      variant: {
        default: "bg-surface hover:bg-surface2/50",
        warning: "bg-warning/5 border border-warning/20",
        error: "bg-destructive/5 border border-destructive/20",
        info: "bg-primary/5 border border-primary/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface LedgerEntryItemProps extends VariantProps<typeof itemVariants> {
  ledgerEntry: LedgerEntry;
  mainCurrency?: string;
  sourceDocumentEntryDate?: string | null;
  onView?: () => void;
  className?: string;
}

/**
 * A simplified entry display component designed for embedding within source document cards.
 * Unlike LedgerEntryCard, this component:
 * - Inherits theme from parent via `variant` prop
 * - Has a more compact layout
 */
export const LedgerEntryItem = memo(function LedgerEntryItem({
  ledgerEntry,
  mainCurrency = "CNY",
  sourceDocumentEntryDate,
  onView,
  variant = "default",
  className,
}: LedgerEntryItemProps) {
  const assignmentState = useCategoryAssignmentEntryState(ledgerEntry.id);
  return (
    <button
      type="button"
      className={cn(
        itemVariants({ variant }),
        assignmentState === "pending" && "bg-primary/5",
        assignmentState === "failed" && "bg-danger/5",
        className
      )}
      onClick={onView}
      disabled={onView == null}
    >
      {/* Left: Icon + Name */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-8 w-8 flex items-center justify-center bg-surface2 rounded-full shrink-0">
          <CategoryIcon iconName={ledgerEntry.category?.icon ?? null} className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className={textRoleClassName("bodyStrong", "truncate")}>{ledgerEntry.itemName}</p>
          </div>

          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {assignmentState != null && <CategoryAssignmentEntryLabel state={assignmentState} />}
            {ledgerEntry.category != null && (
              <div
                className={textRoleClassName(
                  "meta",
                  "flex items-center gap-1 truncate min-w-0 flex-1"
                )}
              >
                <span className="shrink-0">{ledgerEntry.category.name}</span>
                {ledgerEntry.description != null && ledgerEntry.description !== "" && (
                  <span className="hidden sm:contents">
                    <span className="text-muted-foreground/60 shrink-0">·</span>
                    <span className={textRoleClassName("provisional", "truncate")}>
                      {ledgerEntry.description}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Amount */}
      <AmountDisplay
        amount={ledgerEntry.amount}
        currency={ledgerEntry.currency}
        mainCurrency={mainCurrency}
        date={sourceDocumentEntryDate ?? ledgerEntry.createdAt}
        persistedConvertedAmount={ledgerEntry.convertedAmount}
        variant="item"
        className="shrink-0 ml-3"
      />
    </button>
  );
});
