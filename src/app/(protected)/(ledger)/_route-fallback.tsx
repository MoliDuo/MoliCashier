"use client";
import { usePathname } from "next/navigation";
import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import { ledgerTabFromPathname } from "@/modules/workspace/ledger-tabs";

/** The skeleton of whichever route is loading, while its first data is fetched. */
export function LedgerRouteFallback() {
  const tab = ledgerTabFromPathname(usePathname());
  if (tab === "entries") return <DetailsTabSkeleton />;
  if (tab === "stats") return <StatsTabSkeleton />;
  if (tab === "settings") return <SettingsTabSkeleton />;
  return <EntriesTabSkeleton />;
}
