"use client";

import { createContext, useContext } from "react";
import type { BookDto, EntryCategoryWithCountDto, LedgerDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";

/** What every ledger route renders against, resolved once by the shared layout. */
export interface LedgerWorkspaceValue {
  ledger: LedgerDto;
  books: readonly BookDto[];
  categories: EntryCategoryWithCountDto[];
  /** The book being viewed, or null for 总账. */
  recordScope: RecordScope;
  /** The ledger's zone: every day on every route is named in it. */
  timeZone: string;
  /** Today in that zone, kept current across midnight. */
  today: string;
}

export const LedgerWorkspaceContext = createContext<LedgerWorkspaceValue | null>(null);

export function useLedgerWorkspace(): LedgerWorkspaceValue {
  const value = useContext(LedgerWorkspaceContext);
  if (value == null) throw new Error("useLedgerWorkspace must be used within LedgerWorkspace");
  return value;
}
