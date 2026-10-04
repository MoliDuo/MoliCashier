"use client";
import { textRoleClassName } from "@/components/typography";
import type { EntryCategoryWithCount, Ledger } from "@/modules/ledger/contracts";
import { BookkeepingSettings } from "./settings/BookkeepingSettings";
import { AccountSettings } from "./settings/AccountSettings";
import { BookSettings } from "./settings/BookSettings";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { useLedgerSettings } from "@/modules/ledger/hooks/useLedgerSettings";
import { leavePastOverlays } from "@/lib/navigation/overlay-history";
import { forgetLedgerDataOnThisDevice } from "@/lib/sign-out-cleanup";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchEntryCategories } from "@/modules/ledger/queries";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { BookDto } from "@/modules/ledger/contracts";
import { ledgerQueryErrorCopy } from "@/copy/app";

interface SettingsTabProps {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  /** The switcher's books, hydrated by the page bootstrap. */
  initialBooks: readonly BookDto[];
  userEmail?: string;
}

export function SettingsTab({
  ledger,
  initialCategories,
  initialBooks,
  userEmail,
}: SettingsTabProps) {
  const queryClient = useQueryClient();
  const {
    ledger: settingsLedger,
    categories,
    uncategorizedCount,
    credentials,
    settingsQueryStatus,
    updateLedgerMutation,
    clearLearnedPreferences,
    saveCategories,
    generatingCategoryIds,
    failedCategoryIds,
    retryCategoryMetadata,
    createCredential,
    setCredentialBook,
    deleteCredential,
  } = useLedgerSettings({ ledger, initialCategories });
  // The book list is one query: the 分账 section writes it and the API-key
  // pickers read it, so a rename or reorder lands everywhere at once.
  const { books } = useBooks({ initialBooks });
  const reloadCategories = async () => {
    const latest = await fetchEntryCategories();
    queryClient.setQueryData(queryKeys.entryCategories(), latest);
    return latest;
  };

  const signOutTo = async (callbackUrl: string) => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // A full page load, not a client-side push: the old session's cached
      // ledger data must not survive into the login page. The confirmation
      // dialog's history entry goes first: popping it after the load has begun
      // would cancel the load and leave the reader on this page.
      const load = () => window.location.assign(callbackUrl);
      if (!leavePastOverlays(0, load)) load();
    }
  };

  const handleSignOut = async () => {
    forgetLedgerDataOnThisDevice();
    await signOutTo("/login?notice=signed_out");
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 overflow-x-clip">
      {settingsQueryStatus === "error" && (
        <div
          role="alert"
          className={textRoleClassName(
            "body",
            "flex flex-wrap items-center gap-2 border border-danger/30 bg-danger/10 px-3 py-2"
          )}
        >
          <span>{ledgerQueryErrorCopy.description}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void queryClient.refetchQueries({ queryKey: queryKeys.ledger(), type: "active" });
            }}
          >
            <RefreshCw className="size-4" />
            {ledgerQueryErrorCopy.retry}
          </Button>
        </div>
      )}

      <BookkeepingSettings
        settings={settingsLedger.settings}
        categories={categories}
        uncategorizedCount={uncategorizedCount}
        onUpdateSettings={(data) => updateLedgerMutation.mutateAsync(data)}
        onClearLearnedPreferences={() => clearLearnedPreferences.mutateAsync()}
        onSaveCategories={(input) => saveCategories.mutateAsync(input)}
        onReloadCategories={reloadCategories}
        generatingCategoryIds={generatingCategoryIds}
        failedCategoryIds={failedCategoryIds}
        onRetryMetadata={retryCategoryMetadata}
        isSavingCategories={saveCategories.isPending}
      />

      <BookSettings />

      <AccountSettings
        {...(userEmail !== undefined ? { userEmail } : {})}
        credentials={credentials}
        isPending={updateLedgerMutation.isPending}
        books={books ?? initialBooks}
        onCreateCredential={(input) => createCredential.mutateAsync(input)}
        onSetCredentialBook={(id, bookId) =>
          setCredentialBook.mutateAsync({ id, bookId }).then(() => undefined)
        }
        onDeleteCredential={(id) => deleteCredential.mutateAsync(id)}
        onCredentialDialogClose={createCredential.reset}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
