"use client";

import { CircleSlash } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { batchActionsCopy } from "@/copy/workspace";

interface BatchCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: EntryCategoryDto[];
  /** Null clears the category on everything selected. */
  onSelect: (categoryId: string | null) => void;
}

/** One row of the list, shared by every option so the targets all match. */
const OPTION_CLASS = textRoleClassName(
  "body",
  "flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
);

/**
 * The one way to set the category of a selection. A dialog rather than the
 * menu this replaced, so the whole list is on screen at once and the same
 * target size at every width — the date action beside it already opens one.
 *
 * Choosing is the confirmation: the row applies the change and closes, exactly
 * as the menu item did, and the row's own button in the toolbar spins while the
 * write runs.
 */
export function BatchCategoryDialog({
  open,
  onOpenChange,
  categories,
  onSelect,
}: BatchCategoryDialogProps) {
  const choose = (categoryId: string | null) => {
    onSelect(categoryId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="modal" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{batchActionsCopy.manualCategory}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto subtle-scrollbar">
          <button
            type="button"
            onClick={() => choose(null)}
            className={cn(OPTION_CLASS, "text-muted-foreground")}
          >
            <CircleSlash aria-hidden="true" className="h-4 w-4 opacity-50" />
            <span className="min-w-0 flex-1 truncate">{batchActionsCopy.uncategorized}</span>
          </button>
          {categories.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => choose(category.id)}
              className={OPTION_CLASS}
            >
              <CategoryIcon iconName={category.icon} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
