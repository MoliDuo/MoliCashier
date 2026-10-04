"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/ui/icon-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EditSession } from "@/modules/ledger/hooks/useCategoryManagementDraft";
import { commonCopy } from "@/copy/common";
import { settingsCopy } from "@/copy/settings";

interface CategoryEditDialogProps {
  editSession: EditSession | null;
  setEditSession: (updater: (session: EditSession | null) => EditSession | null) => void;
  onRequestClose: () => void;
  onCommit: () => void;
}

export function CategoryEditDialog({
  editSession,
  setEditSession,
  onRequestClose,
  onCommit,
}: CategoryEditDialogProps) {
  return (
    <Dialog open={editSession != null} onOpenChange={(open) => !open && onRequestClose()}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{settingsCopy.editCategoryDialog}</DialogTitle>
        </DialogHeader>
        {editSession == null ? null : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <IconPicker
                value={editSession.draft.icon}
                onChange={(icon) =>
                  setEditSession((session) =>
                    session == null ? null : { ...session, draft: { ...session.draft, icon } }
                  )
                }
              />
              <Input
                value={editSession.draft.name}
                name="categoryName"
                autoComplete="off"
                onChange={(event) =>
                  setEditSession((session) =>
                    session == null
                      ? null
                      : { ...session, draft: { ...session.draft, name: event.target.value } }
                  )
                }
                aria-label={settingsCopy.categoryName}
                className="max-md:h-11"
              />
            </div>
            <Textarea
              value={editSession.draft.description}
              name="categoryDescription"
              autoComplete="off"
              onChange={(event) =>
                setEditSession((session) =>
                  session == null
                    ? null
                    : {
                        ...session,
                        draft: { ...session.draft, description: event.target.value },
                      }
                )
              }
              aria-label={settingsCopy.categoryDescription}
              className="min-h-24 w-full"
            />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onRequestClose}>
            {commonCopy.cancel}
          </Button>
          <Button type="button" disabled={editSession?.draft.name.trim() === ""} onClick={onCommit}>
            {commonCopy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
