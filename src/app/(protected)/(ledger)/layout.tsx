import { Suspense } from "react";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import {
  getLedgerBooksBootstrap,
  getLedgerShellBootstrap,
  loadLedgerView,
  type LedgerView,
} from "@/modules/workspace/server/ledger-page-bootstrap";
import { WorkspaceStoreProvider } from "@/modules/workspace/store";
import { LedgerWorkspace } from "@/modules/workspace/ui/LedgerWorkspace";
import { LedgerRouteFallback } from "./_route-fallback";
import { LedgerShell } from "./_shell";
import { orSignIn } from "./_sign-in";

/**
 * What the ledger's four routes share: the header and tab bar, the book being
 * viewed, the new-record dialog and the detail sheets. Moving between the
 * routes keeps all of it mounted; only the page below it changes.
 */
export default async function LedgerLayout({ children }: { children: React.ReactNode }) {
  const view = await orSignIn(loadLedgerView());

  return (
    <WorkspaceStoreProvider initialBookId={view.bookId}>
      {/* The top bar's book switcher reads the books before anything below it,
          so they are in the cache before the bars render. */}
      <HydrationBoundary state={getLedgerBooksBootstrap(view.books)}>
        <LedgerShell>
          <Suspense fallback={<LedgerRouteFallback />}>
            <LedgerShellData view={view}>{children}</LedgerShellData>
          </Suspense>
        </LedgerShell>
      </HydrationBoundary>
    </WorkspaceStoreProvider>
  );
}

async function LedgerShellData({
  view,
  children,
}: {
  view: LedgerView;
  children: React.ReactNode;
}) {
  const { ledgerDto } = view.context;
  let state: DehydratedState | undefined;
  try {
    state = await getLedgerShellBootstrap({
      ledgerDto,
      categories: view.categories,
      categoryAssignmentJob: view.categoryAssignmentJob,
    });
  } catch (error) {
    logger.error({ error }, "Ledger shell bootstrap failed; falling back to client queries");
  }

  return (
    <HydrationBoundary state={state}>
      <LedgerWorkspace ledgerToday={view.ledgerToday} pendingFallback={<LedgerRouteFallback />}>
        {children}
      </LedgerWorkspace>
    </HydrationBoundary>
  );
}
