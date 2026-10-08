"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The zone the product defaults to before a ledger has loaded. */
const FALLBACK_TIME_ZONE = "Asia/Shanghai";

const LedgerTimeZoneContext = createContext<string>(FALLBACK_TIME_ZONE);

/**
 * The ledger's zone, for the components deep in a view that name a day 今天 or
 * 昨天. It is one value for the whole ledger, so it is provided once by the
 * ledger layout rather than passed down through every list and chart.
 */
export function LedgerTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  return (
    <LedgerTimeZoneContext.Provider value={timeZone}>{children}</LedgerTimeZoneContext.Provider>
  );
}

export function useLedgerTimeZone(): string {
  return useContext(LedgerTimeZoneContext);
}
