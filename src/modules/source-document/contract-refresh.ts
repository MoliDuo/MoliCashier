export interface LedgerRefreshRequest {
  afterVersion: string;
}

export interface LedgerRefreshResult {
  version: string;
  changed: boolean;
  hasTransitionalWork: boolean;
  /**
   * Retired: nothing in this release reads it, and it is always all false. A page loaded before
   * the release still ORs these flags with `changed` and throws if the object is missing, so it
   * is answered for one more release and dropped in the next (expand/contract).
   */
  invalidations: { categories: false; settings: false; stats: false };
}
