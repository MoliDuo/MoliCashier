"use client";

import {
  ArrowDown,
  ArrowUp,
  CircleSlash,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  EntryCategory,
  EntryCategoryWithCount,
  SaveEntryCategoriesInput,
} from "@/modules/ledger/contracts";
import { textRoleClassName } from "@/components/typography";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DraftNotice } from "@/components/ui/draft-notice";
import { Input } from "@/components/ui/input";
import { useCategoryManagementDraft } from "@/modules/ledger/hooks/useCategoryManagementDraft";
import { CategoryEditDialog } from "./CategoryEditDialog";
import { SettingsSection } from "@/components/SettingsSection";
import { useCategoryAssignment } from "./category-assignment-context";
import { commonCopy } from "@/copy/common";
import { settingsCopy } from "@/copy/settings";

interface CategorySectionProps {
  /** Carries `entryCount`, shown beside each category. */
  categories: EntryCategoryWithCount[];
  uncategorizedCount?: number;
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: () => Promise<EntryCategory[]>;
  generatingCategoryIds?: Set<string>;
  failedCategoryIds?: Set<string>;
  onRetryMetadata?: (id: string) => void;
  isSaving?: boolean;
}

export function CategorySection({
  categories,
  uncategorizedCount = 0,
  onSaveCategories,
  onReloadCategories,
  generatingCategoryIds = new Set(),
  failedCategoryIds = new Set(),
  onRetryMetadata,
  isSaving = false,
}: CategorySectionProps) {
  const { isActive: categoryAssignmentActive } = useCategoryAssignment();

  const {
    managing,
    newCategoryName,
    setNewCategoryName,
    editSession,
    setEditSession,
    deleteTarget,
    setDeleteTarget,
    discardManagementOpen,
    setDiscardManagementOpen,
    discardEditOpen,
    setDiscardEditOpen,
    revisionConflict,
    restoredFromDraft,
    saveError,
    dirty,
    displayedCategories,
    enterManagement,
    move,
    createCategory,
    requestEditClose,
    handleSave,
    handleReload,
    startEditing,
    commitEdit,
    cancelManagement,
    confirmDiscardManagement,
    confirmDeleteCategory,
  } = useCategoryManagementDraft({ categories, onSaveCategories, onReloadCategories, isSaving });

  return (
    <SettingsSection
      actions={
        managing ? null : (
          <Button
            type="button"
            size="sm"
            className="max-md:h-11"
            disabled={categoryAssignmentActive}
            onClick={enterManagement}
          >
            {settingsCopy.manageCategories}
          </Button>
        )
      }
    >
      {categoryAssignmentActive ? (
        <div
          className={textRoleClassName(
            "body",
            "border border-warning/30 bg-warning/10 p-3 text-warning"
          )}
          role="status"
        >
          <p>{settingsCopy.categoryAssignmentActive}</p>
        </div>
      ) : null}

      <div className="space-y-2">
        {displayedCategories.map((category, index) => (
          <div
            key={category.key}
            className="flex min-h-14 items-center gap-3 rounded-md bg-surface2 p-3"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center">
              <CategoryIcon iconName={category.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={textRoleClassName("bodyStrong", "min-w-0 truncate")}>
                  {category.name}
                </span>
                {category.entryCount == null ? null : (
                  <span className="text-micro text-muted-foreground">
                    {settingsCopy.categoryItemCount({ count: category.entryCount })}
                  </span>
                )}
                {category.id != null && generatingCategoryIds.has(category.id) ? (
                  <span className="text-micro text-muted-foreground">
                    {settingsCopy.generatingMetadata}
                  </span>
                ) : null}
                {category.id != null &&
                failedCategoryIds.has(category.id) &&
                onRetryMetadata != null ? (
                  <Button
                    type="button"
                    onClick={() => onRetryMetadata(category.id!)}
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-2 text-micro text-danger"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {settingsCopy.retryMetadata}
                  </Button>
                ) : null}
              </div>
              {category.description !== "" ? (
                <p className={textRoleClassName("meta", "line-clamp-2")}>{category.description}</p>
              ) : null}
            </div>
            {managing ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="max-md:size-11"
                  disabled={isSaving}
                  onClick={() => startEditing(category)}
                  aria-label={settingsCopy.editCategory({ name: category.name })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {/* Editing stays on the row; the rarer moves and the delete share
                    one menu, so a phone keeps room for the name. */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="max-md:size-11"
                      disabled={isSaving}
                      aria-label={settingsCopy.categoryMoreActions({ name: category.name })}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      className="max-md:min-h-11"
                      disabled={index === 0}
                      onSelect={() => move(index, -1)}
                    >
                      <ArrowUp className="mr-2 h-4 w-4" />
                      {settingsCopy.moveCategoryUp}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="max-md:min-h-11"
                      disabled={index === displayedCategories.length - 1}
                      onSelect={() => move(index, 1)}
                    >
                      <ArrowDown className="mr-2 h-4 w-4" />
                      {settingsCopy.moveCategoryDown}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger focus:text-danger max-md:min-h-11"
                      onSelect={() => setDeleteTarget(category)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {commonCopy.delete}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </div>
        ))}
        {/* 未分类 is not a category: it is the absence of one, and it is the same
            state 流水 and 明细 already draw with a slashed circle. So it holds the
            last slot with nothing to press — no rename, no reorder, no delete —
            and only the count says what currently sits in it. */}
        <div
          className="flex min-h-14 items-center gap-3 rounded-md bg-surface2 p-3"
          data-testid="uncategorized-row"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center">
            <CircleSlash aria-hidden="true" className="h-5 w-5 opacity-60" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={textRoleClassName("bodyStrong", "min-w-0 truncate")}>
                {settingsCopy.uncategorized}
              </span>
              {uncategorizedCount > 0 ? (
                <span className="text-micro text-warning/80">
                  {settingsCopy.categoryItemCount({ count: uncategorizedCount })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {managing ? (
        <div className="space-y-3">
          {revisionConflict ? (
            <div
              className={textRoleClassName(
                "body",
                "flex flex-wrap items-center justify-between gap-2 border border-warning/30 bg-warning/10 p-3 text-warning"
              )}
              role="status"
            >
              <span>{settingsCopy.categoriesChangedElsewhere}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="max-md:h-11"
                disabled={isSaving}
                onClick={() => void handleReload()}
              >
                {settingsCopy.reloadCategories}
              </Button>
            </div>
          ) : restoredFromDraft ? (
            <DraftNotice disabled={isSaving} onDiscard={confirmDiscardManagement} />
          ) : null}
          <div className="flex gap-2">
            <Input
              value={newCategoryName}
              name="newCategoryName"
              autoComplete="off"
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createCategory();
                }
              }}
              disabled={isSaving}
              aria-label={settingsCopy.newCategoryPlaceholder}
              placeholder={settingsCopy.newCategoryPlaceholder}
              className="max-md:h-11"
            />
            <Button
              type="button"
              size="sm"
              className="max-md:h-11"
              onClick={createCategory}
              disabled={newCategoryName.trim() === "" || isSaving}
            >
              {settingsCopy.addCategory}
            </Button>
          </div>
          {saveError == null ? null : (
            <p
              role="alert"
              aria-live="polite"
              className={textRoleClassName("body", "text-destructive")}
            >
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="max-md:h-11"
              disabled={isSaving}
              onClick={cancelManagement}
            >
              {commonCopy.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              className="max-md:h-11"
              disabled={!dirty || isSaving || revisionConflict}
              onClick={() => void handleSave()}
            >
              {isSaving ? settingsCopy.saving : commonCopy.save}
            </Button>
          </div>
        </div>
      ) : null}

      <CategoryEditDialog
        editSession={editSession}
        setEditSession={setEditSession}
        onRequestClose={requestEditClose}
        onCommit={commitEdit}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={settingsCopy.deleteCategoryDialog}
        description={settingsCopy.deleteCategoryDescription({ name: deleteTarget?.name ?? "" })}
        variant="destructive"
        onConfirm={confirmDeleteCategory}
      />

      <ConfirmDialog
        open={discardManagementOpen}
        onOpenChange={setDiscardManagementOpen}
        title={settingsCopy.discardCategoryChangesTitle}
        description={settingsCopy.discardCategoryChangesDescription}
        variant="destructive"
        confirmLabel={commonCopy.discard}
        onConfirm={async () => {
          confirmDiscardManagement();
          await handleReload();
        }}
      />

      <ConfirmDialog
        open={discardEditOpen}
        onOpenChange={setDiscardEditOpen}
        title={settingsCopy.discardCategoryEditTitle}
        description={settingsCopy.discardCategoryEditDescription}
        variant="destructive"
        confirmLabel={commonCopy.discard}
        onConfirm={() => setEditSession(null)}
      />
    </SettingsSection>
  );
}
