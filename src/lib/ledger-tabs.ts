/**
 * The ledger's routes, each a tab in the navigation bar: `/records` (账目, by
 * bill), `/entries` (明细, by entry), `/stats` (统计) and `/settings` (设置).
 */
export const LEDGER_ROUTES = ["records", "entries", "stats", "settings"] as const;

export type LedgerTab = (typeof LEDGER_ROUTES)[number];

/** The routes that read a period; moving between them carries it along. */
export const LEDGER_PERIOD_TABS: ReadonlySet<LedgerTab> = new Set(["records", "entries", "stats"]);

export function isLedgerTab(value: string | null | undefined): value is LedgerTab {
  return value != null && LEDGER_ROUTES.includes(value as LedgerTab);
}

/** The route a ledger pathname shows; anything else falls back to 账目. */
export function ledgerTabFromPathname(pathname: string | null): LedgerTab {
  const segment = pathname?.split("/")[1] ?? "";
  return isLedgerTab(segment) ? segment : "records";
}

export function ledgerTabHref(tab: LedgerTab, query = ""): string {
  return query === "" ? `/${tab}` : `/${tab}?${query}`;
}
