"use client";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { memo, type ReactNode } from "react";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { EditableCategorySelect } from "@/components/editable-category-select";
import { textRoleClassName } from "@/components/typography";
import { EditableField } from "@/components/ui/editable-field";
import { CalculatorInput } from "@/components/ui/calculator-input";
import { Button } from "@/components/ui/button";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { ChevronDown, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EntryEditData } from "@/modules/source-document/types";
import { getCurrencySymbol } from "@/lib/format/currency";
import { amountTextClassName } from "@/modules/currency/ui/amount-text";
import { AmountDisplay } from "@/modules/currency/ui/AmountDisplay";
import { getCurrencyDecimals } from "@/lib/money/currency-precision";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { commonCopy } from "@/copy/common";
import { calendarCopy } from "@/copy/controls";

function parseAmount(amount: string | null | undefined): number {
  if (amount == null) return 0;
  const parsed = parseFloat(amount);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const itemVariants = cva(
  "flex items-center rounded-lg px-3 py-2 transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)]",
  {
    variants: {
      variant: {
        default: "bg-surface hover:bg-surface2/50",
        /** No surface of its own, for rows sitting on a tinted background. */
        plain: "bg-transparent",
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

export { type EntryEditData };

export interface EditableLedgerEntryItemProps extends VariantProps<typeof itemVariants> {
  ledgerEntry: LedgerEntryDto;
  categories: EntryCategoryDto[];
  /** Only needed while the row is editable; read-only rows never show it. */
  categoryPlaceholder?: string;
  preferredCurrencies?: string[];
  mainCurrency?: string;
  className?: string;
  onChange?: (data: Partial<EntryEditData>) => void;
  pendingChanges?: Partial<EntryEditData>;
  /** The (possibly pending-edited) entryDate of the parent source document, used to detect date differences */
  sourceDocumentEntryDate?: string;
  /**
   * The parent source document's persisted entryDate. `ledgerEntry` here is
   * always the embedded, sourceDocument-less DTO
   * (`LedgerEntryEmbeddedViewDto`), so this must be passed explicitly rather
   * than read off `ledgerEntry.sourceDocument?.entryDate` — that field is
   * structurally never present on this DTO and would silently read as "".
   */
  originalEntryDate: string;
  readOnly?: boolean;
  /** When provided, a delete affordance is shown for this entry (edit mode only). */
  onDelete?: (() => void) | undefined;
  /** Extra control rendered after the amount, e.g. the date-organization picker. */
  trailing?: ReactNode;
}

export const EditableLedgerEntryItem = memo(function EditableLedgerEntryItem({
  ledgerEntry,
  categories,
  categoryPlaceholder = "",
  preferredCurrencies = [],
  mainCurrency = "CNY",
  variant = "default",
  className,
  onChange,
  pendingChanges,
  sourceDocumentEntryDate,
  originalEntryDate,
  readOnly = false,
  onDelete,
  trailing,
}: EditableLedgerEntryItemProps) {
  const locale = DISPLAY_LOCALE;

  // Merge pending changes with original data
  const displayData = {
    itemName: pendingChanges?.itemName ?? ledgerEntry.itemName,
    amount: pendingChanges?.amount ?? ledgerEntry.amount,
    currency: pendingChanges?.currency ?? ledgerEntry.currency,
    categoryId: pendingChanges?.categoryId ?? ledgerEntry.categoryId,
    // A cleared note is a pending null, which must not fall back to the saved one.
    description:
      pendingChanges?.description !== undefined
        ? pendingChanges.description
        : ledgerEntry.description,
  };

  // Only convert live while amount, currency, or the source-document date has
  // unsaved changes; otherwise the persisted accounting value is authoritative.
  const hasPendingValueChanges =
    pendingChanges?.amount !== undefined || pendingChanges?.currency !== undefined;
  const dateHasPendingChange =
    sourceDocumentEntryDate != null &&
    sourceDocumentEntryDate !== "" &&
    sourceDocumentEntryDate !== originalEntryDate;
  const persistedConvertedAmount =
    !hasPendingValueChanges && !dateHasPendingChange ? ledgerEntry.convertedAmount : null;

  const category = categories.find((c) => c.id === displayData.categoryId);
  const hasDescription = displayData.description != null && displayData.description !== "";
  const amountDecimals = getCurrencyDecimals(displayData.currency ?? mainCurrency);

  const sortedCurrencies = (() => {
    const preferred = preferredCurrencies.filter((c) => c !== "unknown");
    const remaining = SUPPORTED_CURRENCIES.filter((c) => !preferred.includes(c));
    return [...preferred, ...remaining.sort()];
  })();

  const handleChange = (field: keyof EntryEditData, value: string | null) => {
    onChange?.({ [field]: value });
  };

  return (
    <div className={cn(itemVariants({ variant }), "gap-1.5 sm:gap-2", className)}>
      {/* Category Icon */}
      <EditableCategorySelect
        value={displayData.categoryId}
        categories={categories}
        onChange={(categoryId) => handleChange("categoryId", categoryId)}
        placeholder={categoryPlaceholder}
        disabled={readOnly}
        iconOnly
      />

      {/* Name + Description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <EditableField
            value={displayData.itemName}
            onChange={(v) => handleChange("itemName", v)}
            placeholder={calendarCopy.productName}
            displayClassName={textRoleClassName("bodyStrong")}
            inputClassName={textRoleClassName("bodyStrong")}
            disabled={readOnly}
          />
        </div>

        {(hasDescription || category != null || !readOnly) && (
          <div className={textRoleClassName("meta", "flex items-center gap-1 mt-0.5")}>
            {category != null && <span className="shrink-0">{category.name}</span>}
            {/* An editable row always offers the note, so one that was never
                written, or was cleared, can still be added. */}
            {(hasDescription || !readOnly) && (
              <>
                {category != null && <span className="text-muted-foreground/60">·</span>}
                <EditableField
                  value={displayData.description ?? ""}
                  onChange={(v) => handleChange("description", v !== "" ? v : null)}
                  placeholder={calendarCopy.addNote}
                  displayClassName="truncate"
                  inputClassName="text-micro"
                  disabled={readOnly}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Amount + Currency */}
      <div className="flex items-center gap-1 shrink-0">
        {readOnly ? (
          // Same two-line amount block the stream rows use: the main-currency
          // value, then the original amount it came from.
          <AmountDisplay
            amount={displayData.amount}
            currency={displayData.currency}
            mainCurrency={mainCurrency}
            date={sourceDocumentEntryDate ?? ledgerEntry.createdAt}
            persistedConvertedAmount={persistedConvertedAmount}
            variant="item"
          />
        ) : (
          <>
            <Popover modal={true}>
              <PopoverTrigger asChild>
                <button
                  aria-label={calendarCopy.currency}
                  className={textRoleClassName(
                    "meta",
                    "hover:text-text transition-colors flex items-center gap-0.5"
                  )}
                >
                  {getCurrencySymbol(displayData.currency ?? "unknown", locale)}
                  <ChevronDown aria-hidden="true" className="h-2.5 w-2.5 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-24 p-1" align="end">
                <div className="max-h-48 overflow-y-auto">
                  {sortedCurrencies.map((curr) => (
                    <button
                      key={curr}
                      onClick={() => handleChange("currency", curr)}
                      className={cn(
                        textRoleClassName(
                          "meta",
                          "w-full text-left px-2 py-1.5 rounded text-text hover:bg-accent transition-colors"
                        ),
                        displayData.currency === curr && "bg-accent"
                      )}
                    >
                      {curr}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <CalculatorInput
              value={displayData.amount ?? "0"}
              onChange={(v) => handleChange("amount", v)}
              displayClassName={amountTextClassName("item")}
              allowNegative={parseAmount(displayData.amount) < 0}
              preserveDirection
              maxDecimals={amountDecimals}
            />
          </>
        )}
      </div>

      {trailing}

      {!readOnly && onDelete != null && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
          onClick={onDelete}
          aria-label={commonCopy.delete}
          title={commonCopy.delete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
});
