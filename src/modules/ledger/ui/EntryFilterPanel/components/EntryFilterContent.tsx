"use client";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { CategoryIcon } from "@/components/CategoryIcon";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import type { EntryFilters } from "@/modules/ledger/filters";
import { settingsCopy } from "@/copy/settings";
import { entryFilterPanelCopy } from "@/copy/workspace";

const STATUS_OPTIONS: SourceDocumentProcessingStatus[] = [
  "processing",
  "completed",
  "failed",
  "cancelled",
];

interface EntryFilterContentProps {
  tempFilters: EntryFilters;
  setTempFilters: (updater: (prev: EntryFilters) => EntryFilters) => void;
  handleApply: () => void;
  handleReset: () => void;
  toggleStatus: (status: SourceDocumentProcessingStatus) => void;
  categories: EntryCategoryDto[];
  preferredCurrencies: string[];
  showCategory: boolean;
  showCurrency: boolean;
  showStatus: boolean;
}

export function EntryFilterContent({
  tempFilters,
  setTempFilters,
  handleApply,
  handleReset,
  toggleStatus,
  categories,
  preferredCurrencies,
  showCategory,
  showCurrency,
  showStatus,
}: EntryFilterContentProps) {
  const statusLabel = (status: SourceDocumentProcessingStatus) => {
    switch (status) {
      case "processing":
        return entryFilterPanelCopy.statusProcessing;
      case "completed":
        return entryFilterPanelCopy.statusCompleted;
      case "failed":
        return entryFilterPanelCopy.statusFailed;
      case "cancelled":
        return entryFilterPanelCopy.statusCancelled;
    }
  };
  // The footer stays put while the sections scroll, so the primary action is
  // never something the user has to scroll to find.
  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Input
          type="search"
          name="search"
          autoComplete="off"
          value={tempFilters.search ?? ""}
          onChange={(event) =>
            setTempFilters((previous) => ({
              ...previous,
              search: event.target.value === "" ? null : event.target.value,
            }))
          }
          placeholder={entryFilterPanelCopy.searchPlaceholder}
          aria-label={entryFilterPanelCopy.searchPlaceholder}
        />

        {showCategory && (
          <Select
            value={tempFilters.categoryId ?? "__all__"}
            onValueChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                categoryId: value === "__all__" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label={entryFilterPanelCopy.category} className="w-full">
              <SelectValue placeholder={entryFilterPanelCopy.allCategories} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__all__">{entryFilterPanelCopy.allCategories}</SelectItem>
              <SelectItem value="__uncategorized__">{settingsCopy.uncategorized}</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  <CategoryIcon iconName={cat.icon} className="w-4 h-4 mr-2 inline-block" />
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {showCurrency && preferredCurrencies.length > 0 && (
          <Select
            value={tempFilters.currency ?? "__all__"}
            onValueChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                currency: value === "__all__" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label={entryFilterPanelCopy.currency} className="w-full">
              <SelectValue placeholder={entryFilterPanelCopy.allCurrencies} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="__all__">{entryFilterPanelCopy.allCurrencies}</SelectItem>
              {preferredCurrencies.map((curr) => (
                <SelectItem key={curr} value={curr}>
                  {curr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-2">
          <AmountInput
            placeholder={entryFilterPanelCopy.minAmount}
            aria-label={entryFilterPanelCopy.minAmount}
            name="minAmount"
            value={tempFilters.minAmount ?? ""}
            allowNegative
            onChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                minAmount: value !== "" ? value : null,
              }))
            }
            className="min-w-0 flex-1"
          />
          <span className={textRoleClassName("bodyMuted")}>-</span>
          <AmountInput
            placeholder={entryFilterPanelCopy.maxAmount}
            aria-label={entryFilterPanelCopy.maxAmount}
            name="maxAmount"
            value={tempFilters.maxAmount ?? ""}
            allowNegative
            onChange={(value) =>
              setTempFilters((prev) => ({
                ...prev,
                maxAmount: value !== "" ? value : null,
              }))
            }
            className="min-w-0 flex-1"
          />
        </div>

        {showStatus && (
          // A chosen status is outlined the way a chosen card is. Toggling a
          // chip off is how the status filter is cleared, so there is still no
          // 全部状态 control restating the empty state.
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={entryFilterPanelCopy.status}
          >
            {STATUS_OPTIONS.map((status) => {
              const isSelected = tempFilters.statuses?.includes(status) ?? false;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleStatus(status)}
                  className={cn(
                    textRoleClassName(
                      "body",
                      "rounded-full border px-3 py-1.5 transition-colors duration-[var(--motion-feedback)]"
                    ),
                    isSelected
                      ? "border-primary bg-primary/5 font-medium text-primary ring-1 ring-primary/20"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-text"
                  )}
                >
                  {statusLabel(status)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" size="sm" className="flex-1" onClick={handleReset}>
          {entryFilterPanelCopy.reset}
        </Button>
        <Button size="sm" className="flex-1" onClick={handleApply}>
          {entryFilterPanelCopy.apply}
        </Button>
      </div>
    </div>
  );
}
