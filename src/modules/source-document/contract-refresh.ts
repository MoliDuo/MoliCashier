export interface LedgerRefreshRequest {
  afterVersion: string;
}

export interface LedgerRefreshResult {
  version: string;
  changed: boolean;
  hasTransitionalWork: boolean;
}
