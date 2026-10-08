"use client";
import { useMemo, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppError } from "@/lib/errors";
import { LedgerTimeZoneProvider } from "@/components/providers/ledger-time-zone";
import { ledgerTabFromPathname } from "@/modules/workspace/ledger-tabs";
import { readLedgerDetailParam } from "@/modules/ledger/navigation/ledger-detail-navigation";
import {
  closeNewRecord,
  readNewRecordParam,
} from "@/modules/ledger/navigation/ledger-new-record-navigation";
import { textRoleClassName } from "@/components/typography";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
import { useLedgerHistorySync } from "../hooks/useLedgerHistorySync";
import { useLedgerPageEnvironment } from "../hooks/useLedgerPageEnvironment";
import { useRecordScope } from "../hooks/useRecordScope";
import { resolvePeriod } from "@/modules/ledger/domain/period";
import { buildLedgerEntryFilters } from "../ledger-filter-state";
import { readLedgerFilterParams } from "../ledger-url-params";
import { readPeriodParams } from "../period-url-params";
import { useLedgerToday } from "../hooks/useLedgerToday";
import { useLedgerSync } from "../hooks/useLedgerSync";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { NewRecordSheet } from "./NewRecordSheet";
import { DetailSheetHost } from "./DetailSheetHost";
import { LedgerWorkspaceContext, type LedgerWorkspaceValue } from "./ledger-workspace-context";
import { ledgerPageCopy } from "@/copy/app";

interface LedgerWorkspaceProps {
  /** Today in the ledger's zone as the server dated it, so the first render agrees. */
  ledgerToday?: string | undefined;
  /** Shown while the ledger itself is still being read: the route's skeleton. */
  pendingFallback?: ReactNode;
  children: ReactNode;
}

function isLedgerMissing(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 404;
}

/** Only before the ledger itself has loaded; the ledger always names its zone. */
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

/**
 * The part of the ledger that outlives a route change: the book scope, the
 * new-record dialog, the detail sheets and the queries every route reads.
 * The route itself arrives as `children`.
 */
export function LedgerWorkspace({
  ledgerToday,
  pendingFallback = null,
  children,
}: LedgerWorkspaceProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = ledgerTabFromPathname(pathname);
  const { books } = useBooks({});
  // Forgets a book that stopped being live and remembers the choice in a cookie;
  // the top bar's switcher is where the choice is made.
  const { recordScope } = useRecordScope(books);
  useLedgerHistorySync({ activeTab, pathname, searchParams });

  const {
    ledger,
    ledgerQuery,
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
  } = useLedgerPageEnvironment();
  // The one refresh driver: every route below is kept current by this poll.
  useLedgerSync();
  const timeZone = ledger?.settings.timeZone ?? DEFAULT_TIME_ZONE;
  const today = useLedgerToday(timeZone, ledgerToday);

  // A new record is checked against what 流水 is showing, to say when it will
  // not appear there.
  const committedView = useMemo(
    () => ({
      filters: buildLedgerEntryFilters(readLedgerFilterParams(searchParams)),
      range: resolvePeriod(readPeriodParams(searchParams), today),
    }),
    [searchParams, today]
  );

  const value = useMemo<LedgerWorkspaceValue | null>(
    () =>
      ledger == null
        ? null
        : {
            ledger,
            books: books ?? [],
            categories,
            recordScope,
            timeZone,
            today,
          },
    [books, categories, ledger, recordScope, timeZone, today]
  );

  if (value == null) {
    // Only a 404 means there is no ledger. A read still on its way shows the
    // route's skeleton, and one that failed offers to try again.
    if (ledgerQuery.isPending) return pendingFallback;
    if (!isLedgerMissing(ledgerQuery.error)) {
      return <LedgerQueryErrorBanner empty onRetry={() => void ledgerQuery.refetch()} />;
    }
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <h1 className={textRoleClassName("pageTitle")}>{ledgerPageCopy.notFound}</h1>
      </div>
    );
  }

  return (
    <LedgerWorkspaceContext.Provider value={value}>
      <LedgerTimeZoneProvider timeZone={timeZone}>
        <CategoryAssignmentProvider>
          {categoriesQuery.isError ? (
            <LedgerQueryErrorBanner
              empty={categoriesHaveNoData}
              onRetry={() => void categoriesQuery.refetch()}
            />
          ) : null}
          {/* The page does not wait for the categories: a row whose category
              has not loaded yet shows a neutral icon until it does. */}
          <div className="min-w-0 max-w-full overflow-x-clip">{children}</div>

          <NewRecordSheet
            open={readNewRecordParam(searchParams)}
            onClose={closeNewRecord}
            scope={recordScope}
            books={value.books}
            activeTab={activeTab}
            committedView={committedView}
            timeZone={timeZone}
          />

          <DetailSheetHost
            detailId={readLedgerDetailParam(searchParams)}
            books={value.books}
            categories={categories}
            mainCurrency={mainCurrency}
            preferredCurrencies={preferredCurrencies}
            timeZone={timeZone}
          />
        </CategoryAssignmentProvider>
      </LedgerTimeZoneProvider>
    </LedgerWorkspaceContext.Provider>
  );
}
