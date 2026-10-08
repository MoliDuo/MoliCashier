"use client";
import { SlidersHorizontal } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TOOLBAR_CONTROL_CLASS } from "@/components/toolbar-control";
import { cn } from "@/lib/utils";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import {
  CLEARED_ENTRY_FILTERS,
  useEntryFilterDraft,
} from "./EntryFilterPanel/hooks/useEntryFilterDraft";
import { EntryFilterContent } from "./EntryFilterPanel/components/EntryFilterContent";
import type { EntryFilters } from "@/modules/ledger/filters";
import { entryFilterPanelCopy } from "@/copy/workspace";

export type { EntryFilters } from "@/modules/ledger/filters";

interface EntryFilterPanelProps {
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  categories?: EntryCategoryDto[];
  preferredCurrencies?: string[];
  showCategory?: boolean;
  showCurrency?: boolean;
  showStatus?: boolean;
  className?: string;
}

/**
 * The filter is one dialog at every width, the way every other box in the app
 * opens — never a panel anchored to the trigger and no longer a bottom sheet on
 * a phone. The draft and its 应用筛选 are what make that possible: the panel
 * covers the toolbar it was opened from, so it has to carry its own title and
 * its own apply.
 */
export function EntryFilterPanel({
  filters,
  onFiltersChange,
  categories = [],
  preferredCurrencies = [],
  showCategory = true,
  showCurrency = true,
  showStatus = true,
  className,
}: EntryFilterPanelProps) {
  const draft = useEntryFilterDraft({
    filters,
    onFiltersChange,
    showCategory,
    showCurrency,
    showStatus,
  });
  const { open, handleOpenChange, activeFilterCount } = draft;

  const trigger = (
    <Button
      variant="outline"
      className={cn(
        TOOLBAR_CONTROL_CLASS,
        "shrink-0",
        activeFilterCount > 0 && "border-primary/50 text-primary"
      )}
      onClick={() => handleOpenChange(true)}
      aria-label={
        activeFilterCount > 0
          ? entryFilterPanelCopy.activeFilterCount({ count: activeFilterCount })
          : entryFilterPanelCopy.filter
      }
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <SlidersHorizontal aria-hidden="true" />
      <span>{entryFilterPanelCopy.filter}</span>
      {activeFilterCount > 0 && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-micro font-medium text-primary">
          {activeFilterCount}
        </span>
      )}
    </Button>
  );

  const filterContent = (
    <EntryFilterContent
      {...draft}
      categories={categories}
      preferredCurrencies={preferredCurrencies}
      showCategory={showCategory}
      showCurrency={showCurrency}
      showStatus={showStatus}
    />
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {trigger}
      {activeFilterCount > 0 ? (
        <Button
          variant="ghost"
          className={cn(TOOLBAR_CONTROL_CLASS, "shrink-0 text-muted-foreground")}
          onClick={() => onFiltersChange(CLEARED_ENTRY_FILTERS)}
        >
          {entryFilterPanelCopy.clearFilters}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          variant="modal"
          // The header and the footer are fixed rows; the sections between them
          // are the only thing that scrolls, so 应用筛选 is never scrolled away.
          className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <DialogHeader className="border-b border-border px-4 py-3 pr-12">
            <DialogTitle className={textRoleClassName("bodyStrong")}>
              {entryFilterPanelCopy.filter}
            </DialogTitle>
          </DialogHeader>
          {filterContent}
        </DialogContent>
      </Dialog>
    </div>
  );
}
