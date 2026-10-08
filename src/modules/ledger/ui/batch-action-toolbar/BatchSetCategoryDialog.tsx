"use client";

import { CircleSlash } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import type { EntryCategoryDto } from "@/modules/ledger/contracts";
import { isConfirmableBatchCategoryPick, resolveBatchCategoryPick } from "./batch-category-pick";
import { batchActionsCopy } from "@/copy/workspace";

interface BatchSetCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: EntryCategoryDto[];
  selectedCount: number;
  /** Null is the clear row, which excludes every category pick. */
  pickedCategoryIds: readonly string[];
  clearPicked: boolean;
  onTogglePick: (categoryId: string | null, picked: boolean) => void;
  isConfirming: boolean;
  onConfirm: () => void;
}

/**
 * The one way to decide the category of a selection, and the reason there is
 * only one: picking a single category is the user's own answer and is applied
 * as such, while picking several is a question the model answers per entry. The
 * two used to be separate buttons in the band, which made the user choose the
 * mechanism before they had chosen the categories.
 *
 * Confirming is a step of its own, unlike the pickers beside it: a pick here is
 * ambiguous until the summary says which of the two things it will do.
 *
 * The clear row is exclusive because "no category" is not a candidate for the
 * model to weigh — an entry it cannot place stays where it is, which is a
 * different outcome from being emptied.
 */
export function BatchSetCategoryDialog({
  open,
  onOpenChange,
  categories,
  selectedCount,
  pickedCategoryIds,
  clearPicked,
  onTogglePick,
  isConfirming,
  onConfirm,
}: BatchSetCategoryDialogProps) {
  const pick = resolveBatchCategoryPick({ categoryIds: pickedCategoryIds, clearPicked });
  const confirmable = isConfirmableBatchCategoryPick(pick);
  const pickedName =
    pick.kind === "assign"
      ? (categories.find((category) => category.id === pick.categoryId)?.name ?? "")
      : "";

  const summary = (() => {
    switch (pick.kind) {
      case "clear":
        return batchActionsCopy.categoryPickClear({ count: selectedCount });
      case "assign":
        return batchActionsCopy.categoryPickAssign({ count: selectedCount, name: pickedName });
      case "ai":
        return batchActionsCopy.categoryPickAi({
          entryCount: selectedCount,
          categoryCount: pick.categoryIds.length,
        });
      case "none":
        return "";
    }
  })();
  const confirmLabel =
    pick.kind === "assign"
      ? batchActionsCopy.categoryAssignConfirm({ name: pickedName })
      : pick.kind === "ai"
        ? batchActionsCopy.categoryAiConfirm({ count: selectedCount })
        : pick.kind === "clear"
          ? batchActionsCopy.categoryClearConfirm({ count: selectedCount })
          : batchActionsCopy.confirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isConfirming) onOpenChange(next);
      }}
    >
      <DialogContent
        variant="detail"
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:rounded-lg"
        aria-describedby={undefined}
        hideCloseButton={isConfirming}
        onEscapeKeyDown={(event) => {
          if (isConfirming) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isConfirming) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-12 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{batchActionsCopy.manualCategory}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 subtle-scrollbar sm:p-6">
          <p className={textRoleClassName("bodyMuted")}>
            {batchActionsCopy.categoryPickDescription({ count: selectedCount })}
          </p>
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                isConfirming ||
                categories.every((category) => pickedCategoryIds.includes(category.id))
              }
              onClick={() => categories.forEach((category) => onTogglePick(category.id, true))}
            >
              {batchActionsCopy.categorySelectAllCandidates}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isConfirming || pickedCategoryIds.length === 0}
              onClick={() => pickedCategoryIds.forEach((id) => onTogglePick(id, false))}
            >
              {batchActionsCopy.categoryClearCandidates}
            </Button>
          </div>
          <div className="divide-y divide-border">
            {categories.map((category) => {
              const checked = pickedCategoryIds.includes(category.id);
              return (
                <label
                  key={category.id}
                  className={cn(
                    textRoleClassName(
                      "body",
                      "flex min-h-11 w-full cursor-pointer items-start gap-2 px-2 py-3 transition-colors"
                    ),
                    checked ? "bg-accent/60" : "hover:bg-accent"
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={isConfirming}
                    onCheckedChange={(next) => onTogglePick(category.id, next === true)}
                  />
                  <CategoryIcon iconName={category.icon} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{category.name}</span>
                    {category.description == null || category.description === "" ? null : (
                      <details className={textRoleClassName("meta")}>
                        <summary className="line-clamp-2 cursor-pointer list-none">
                          {category.description}
                        </summary>
                        <p className="mt-1">{category.description}</p>
                      </details>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="my-3 h-px bg-border" />
          <label
            className={cn(
              textRoleClassName(
                "body",
                "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 transition-colors"
              ),
              clearPicked ? "bg-accent/60 text-text" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Checkbox
              checked={clearPicked}
              disabled={isConfirming}
              onCheckedChange={(next) => onTogglePick(null, next === true)}
            />
            <CircleSlash aria-hidden="true" className="h-4 w-4 opacity-50" />
            <span className="min-w-0 flex-1">{batchActionsCopy.categoryClearChoice}</span>
          </label>
          {pick.kind === "ai" ? (
            <p className={textRoleClassName("bodyMuted", "mt-3")}>
              {batchActionsCopy.categoryAiStrictDescription}
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:items-center sm:justify-between sm:space-x-0 sm:px-6 sm:py-4">
          <p className={textRoleClassName("meta")} aria-live="polite">
            {summary || batchActionsCopy.categorySelectionRequired}
          </p>
          <Button
            type="button"
            disabled={!confirmable || isConfirming || selectedCount === 0}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
