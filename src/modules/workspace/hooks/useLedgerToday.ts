"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDateInTimezone } from "@/lib/date-utils";
import { invalidateVisibleLedger } from "@/lib/mutations/ledger-sync";

function todayIn(timeZone: string): string {
  return getDateInTimezone(timeZone) ?? getDateInTimezone("UTC")!;
}

/**
 * Today in the ledger's zone. It is checked again every minute and whenever the
 * page comes back into view, so a tab left open overnight moves to the new day
 * instead of reading yesterday's month.
 *
 * The ledger's query keys name the period relative to today (`month:0`), not
 * its dates, so a new day changes no key: the visible queries are read again
 * here instead.
 */
export function useLedgerToday(timeZone: string, initialToday?: string): string {
  const [today, setToday] = useState(() => initialToday ?? todayIn(timeZone));

  useEffect(() => {
    const update = () => setToday(todayIn(timeZone));
    update();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [timeZone]);

  const queryClient = useQueryClient();
  const previousToday = useRef(today);
  useEffect(() => {
    if (previousToday.current === today) return;
    previousToday.current = today;
    // A query that fails shows its own error; nothing waits on this.
    void invalidateVisibleLedger(queryClient).catch(() => undefined);
  }, [queryClient, today]);

  return today;
}
