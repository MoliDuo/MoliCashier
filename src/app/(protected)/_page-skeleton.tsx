"use client";
import { usePathname } from "next/navigation";
import { LedgerPageSkeleton } from "@/components/skeletons";
import { ledgerTabFromPathname } from "@/lib/ledger-tabs";

/** The skeleton of the route being opened, not always the records list. */
export function ProtectedPageSkeleton() {
  return <LedgerPageSkeleton page={ledgerTabFromPathname(usePathname())} />;
}
