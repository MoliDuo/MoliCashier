import type { ReactNode } from "react";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";
import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "./TabSkeletons";

/**
 * The whole ledger page while its first server render is on the way: the bars
 * and the skeleton of the route being opened. It is only a picture, so it
 * names no landmarks; the real page brings its own <main>.
 */
export function LedgerPageSkeleton({ page = "records" }: { page?: LedgerTab }) {
  const contentByPage: Record<LedgerTab, ReactNode> = {
    records: <EntriesTabSkeleton />,
    entries: <DetailsTabSkeleton />,
    stats: <StatsTabSkeleton />,
    settings: <SettingsTabSkeleton />,
  };

  return (
    <div aria-hidden="true" className="min-h-screen bg-bg text-text">
      {/* Header skeleton */}
      <div className="sticky top-0 z-header border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-3 sm:px-4 md:px-6">
          <div className="h-4 w-16 animate-pulse rounded bg-surface2" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-primary/20" />
        </div>
      </div>

      <div className="relative z-content mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 md:px-6">
        {contentByPage[page]}
      </div>
    </div>
  );
}
