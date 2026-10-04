"use client";

import type {
  BookDto,
  CreatedServiceCredentialDto,
  ServiceCredential,
} from "@/modules/ledger/contracts";
import { ServiceCredentialSection } from "../ServiceCredentialSection";
import { SettingsField } from "@/components/SettingsField";
import { SettingsSection } from "@/components/SettingsSection";
import { textRoleClassName } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { settingsCopy } from "@/copy/settings";

interface AccountSettingsProps {
  /** The address the identity provider vouched for when this session signed in. */
  userEmail?: string;
  credentials: ServiceCredential[];
  isPending: boolean;
  books: readonly BookDto[];
  onCreateCredential: (input: {
    name: string;
    bookId: string;
  }) => Promise<CreatedServiceCredentialDto>;
  onSetCredentialBook: (id: string, bookId: string) => Promise<void>;
  onDeleteCredential: (id: string) => Promise<void>;
  onCredentialDialogClose: () => void;
  onSignOut: () => void | Promise<void>;
}

export function AccountSettings({
  userEmail,
  credentials,
  isPending,
  books,
  onCreateCredential,
  onSetCredentialBook,
  onDeleteCredential,
  onCredentialDialogClose,
  onSignOut,
}: AccountSettingsProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  return (
    <>
      {/* API 密钥 saves on its own and binds each key to a 分账, so it is a card
          of its own right after them. */}
      <ServiceCredentialSection
        credentials={credentials}
        books={books}
        onCreateCredential={onCreateCredential}
        onSetCredentialBook={onSetCredentialBook}
        onDeleteCredential={onDeleteCredential}
        onCredentialDialogClose={onCredentialDialogClose}
      />
      {/* 账户 shows who is signed in; signing out closes the session and the page. */}
      <SettingsSection>
        {userEmail != null && userEmail !== "" && (
          <SettingsField title={settingsCopy.signedInAs} stacked>
            <p className={textRoleClassName("body", "break-all")}>{userEmail}</p>
          </SettingsField>
        )}
        {/* The button sits on the heading row at every width instead of
            dropping under its own label on a phone. */}
        <SettingsField
          title={settingsCopy.signOutHere}
          stacked
          actions={
            <Button
              variant="destructive"
              size="sm"
              className="max-md:h-11"
              disabled={isPending || isSigningOut}
              onClick={() => setSignOutConfirmOpen(true)}
            >
              {settingsCopy.signOut}
            </Button>
          }
        />
      </SettingsSection>
      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title={settingsCopy.signOutConfirmTitle}
        description={settingsCopy.signOutConfirmDescription}
        confirmLabel={settingsCopy.signOut}
        variant="destructive"
        onConfirm={async () => {
          if (isSigningOut) return false;
          setIsSigningOut(true);
          try {
            await onSignOut();
            return true;
          } finally {
            setIsSigningOut(false);
          }
        }}
      />
    </>
  );
}

export type { AccountSettingsProps };
