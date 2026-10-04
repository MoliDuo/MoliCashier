"use client";
import { useEffect, useState } from "react";
import { Trash2, Copy, Check } from "lucide-react";
import type {
  BookDto,
  ServiceCredential,
  CreatedServiceCredentialDto,
} from "@/modules/ledger/contracts";
import { toast } from "sonner";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatInstantDateLabel } from "@/lib/date-utils";
import { copyToClipboard } from "@/lib/utils";
import { UI, DISPLAY_LOCALE } from "@/lib/constants";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SettingsSection } from "@/components/SettingsSection";
import { commonCopy } from "@/copy/common";
import { serviceCredentialsCopy, settingsBooksCopy } from "@/copy/settings";

interface ServiceCredentialSectionProps {
  credentials: ServiceCredential[];
  /** The live books; a key's book can be picked at creation and changed later. */
  books: readonly BookDto[];
  onCreateCredential: (input: {
    name: string;
    bookId: string;
  }) => Promise<CreatedServiceCredentialDto>;
  onSetCredentialBook: (id: string, bookId: string) => Promise<void>;
  onDeleteCredential: (id: string) => Promise<void>;
  onCredentialDialogClose?: () => void;
}

export function ServiceCredentialSection({
  credentials,
  books,
  onCreateCredential,
  onSetCredentialBook,
  onDeleteCredential,
  onCredentialDialogClose,
}: ServiceCredentialSectionProps) {
  const locale = DISPLAY_LOCALE;
  const firstBookId = books[0]?.id ?? "";
  const [newCredName, setNewCredName] = useState("");
  const [newCredBookId, setNewCredBookId] = useState(firstBookId);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [credentialToDelete, setCredentialToDelete] = useState<ServiceCredential | null>(null);
  const [createdCredential, setCreatedCredential] = useState<CreatedServiceCredentialDto | null>(
    null
  );
  const [hasCopied, setHasCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openCreateDialog = () => {
    // Each opening starts from the first book in 设置 order, not the last choice.
    setNewCredBookId(firstBookId);
    setIsCreateDialogOpen(true);
  };

  useEffect(() => {
    if (!hasCopied) return;

    const timer = setTimeout(() => setHasCopied(false), UI.COPY_FEEDBACK_DURATION_MS);
    return () => clearTimeout(timer);
  }, [hasCopied]);

  const handleCreate = async () => {
    if (newCredName.trim() === "" || newCredBookId === "" || isCreating) return;

    setIsCreating(true);
    try {
      const newCredential = await onCreateCredential({
        name: newCredName.trim(),
        bookId: newCredBookId,
      });
      setCreatedCredential(newCredential);
      setNewCredName("");
      setIsCreateDialogOpen(false);
    } catch (error) {
      console.error("Failed to create credential", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);

    if (success) {
      setHasCopied(true);
      toast.success(serviceCredentialsCopy.copied);
      return;
    }

    toast.error(commonCopy.error);
  };

  const closeCreatedCredentialDialog = () => {
    setCreatedCredential(null);
    setHasCopied(false);
    onCredentialDialogClose?.();
  };

  // A key whose book is gone (archived behind its back) still lists, and says
  // so rather than showing an empty name or a generic error.
  const bookName = (bookId: string) =>
    books.find((book) => book.id === bookId)?.name ?? serviceCredentialsCopy.archivedBook;

  return (
    <SettingsSection
      actions={
        <Button
          onClick={openCreateDialog}
          size="sm"
          className="max-md:h-11"
          disabled={isCreating || isDeleting}
        >
          {serviceCredentialsCopy.newCredential}
        </Button>
      }
    >
      {credentials.length === 0 ? (
        <div
          className={textRoleClassName(
            "bodyMuted",
            "rounded-[var(--radius)] border border-dashed border-border py-8 text-center"
          )}
        >
          {serviceCredentialsCopy.noCredentials}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {credentials.map((credential) => (
            // On a phone the book picker drops under the key, which would
            // otherwise leave the name and token about 60px.
            <li key={credential.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <span className={textRoleClassName("bodyStrong", "block truncate")}>
                  {credential.name}
                </span>
                <p className="mt-0.5 truncate text-micro">
                  <span className="font-mono">
                    {credential.tokenPrefix && credential.tokenSuffix
                      ? `${credential.tokenPrefix}...${credential.tokenSuffix}`
                      : "******"}
                  </span>
                  <span aria-hidden> · </span>
                  {serviceCredentialsCopy.createdAt({
                    date: formatInstantDateLabel(credential.createdAt, locale),
                  })}
                </p>
              </div>
              <div className="flex w-full items-center gap-1 sm:w-auto sm:shrink-0">
                {/* The picker names its own book, so the row states it once; a key
                    whose book is gone still names itself as archived here. */}
                <Select
                  value={credential.bookId}
                  onValueChange={(bookId) => void onSetCredentialBook(credential.id, bookId)}
                  disabled={isCreating || isDeleting}
                >
                  <SelectTrigger
                    className="min-w-0 flex-1 max-md:h-11 sm:max-w-40 sm:flex-none"
                    aria-label={serviceCredentialsCopy.changeBook({ name: credential.name })}
                  >
                    <SelectValue>{bookName(credential.bookId)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {books.map((book) => (
                      <SelectItem key={book.id} value={book.id}>
                        {book.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isCreating || isDeleting}
                  onClick={() => setCredentialToDelete(credential)}
                  aria-label={serviceCredentialsCopy.deleteButton({ name: credential.name })}
                  title={serviceCredentialsCopy.deleteButton({ name: credential.name })}
                  className="text-muted-foreground hover:text-danger max-md:size-11"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => !isCreating && setIsCreateDialogOpen(open)}
      >
        <DialogContent
          variant="sheet"
          hideCloseButton={isCreating}
          onEscapeKeyDown={(event) => isCreating && event.preventDefault()}
          onPointerDownOutside={(event) => isCreating && event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{serviceCredentialsCopy.createTitle}</DialogTitle>
            <DialogDescription>{serviceCredentialsCopy.createDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              placeholder={serviceCredentialsCopy.namePlaceholder}
              aria-label={serviceCredentialsCopy.namePlaceholder}
              name="credentialName"
              autoComplete="off"
              value={newCredName}
              disabled={isCreating}
              onChange={(event) => setNewCredName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleCreate()}
              className="max-md:h-11"
            />
            <div className="space-y-2">
              <Label htmlFor="credential-book">{commonCopy.book}</Label>
              <Select value={newCredBookId} onValueChange={setNewCredBookId} disabled={isCreating}>
                <SelectTrigger id="credential-book" className="w-full max-md:h-11">
                  <SelectValue placeholder={settingsBooksCopy.namePlaceholder} />
                </SelectTrigger>
                <SelectContent position="popper">
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-micro text-muted-foreground">{serviceCredentialsCopy.bookDesc}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isCreating}
            >
              {commonCopy.cancel}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={newCredName.trim() === "" || newCredBookId === "" || isCreating}
            >
              {commonCopy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createdCredential != null}>
        <DialogContent
          variant="modal"
          hideCloseButton
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{serviceCredentialsCopy.createSuccessTitle}</DialogTitle>
            <DialogDescription>{serviceCredentialsCopy.createSuccessDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div
              className={textRoleClassName(
                "body",
                "break-all rounded border bg-surface p-4 font-mono"
              )}
            >
              {createdCredential?.token}
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => handleCopy(createdCredential?.token ?? "")}
              variant={hasCopied ? "outline" : "default"}
            >
              {hasCopied ? <Check size={16} /> : <Copy size={16} />}
              {hasCopied ? commonCopy.success : serviceCredentialsCopy.copyCredential}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={closeCreatedCredentialDialog}>{serviceCredentialsCopy.saved}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={credentialToDelete != null}
        onOpenChange={(open) => !open && setCredentialToDelete(null)}
        title={serviceCredentialsCopy.deleteTitle}
        description={serviceCredentialsCopy.deleteDesc({ name: credentialToDelete?.name ?? "" })}
        confirmLabel={commonCopy.delete}
        variant="destructive"
        onConfirm={async () => {
          if (credentialToDelete == null || isDeleting) return;
          setIsDeleting(true);
          try {
            await onDeleteCredential(credentialToDelete.id);
            setCredentialToDelete(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </SettingsSection>
  );
}
