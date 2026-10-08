export interface LedgerSettings {
  aiLanguage: string;
  currencies: string[];
  mainCurrency: string;
  collapseEntriesDefault: boolean;
  aiCustomPrompt: string;
  /** What maintenance learned from the owner's corrections; editable, never the prompt above. */
  aiLearnedPreferences: string;
  /** When maintenance last wrote the learned text; null before the first run. */
  aiLearnedPreferencesUpdatedAt: string | null;
  /** Off, corrections are not recorded and nothing new is learned. */
  aiPreferenceLearningEnabled: boolean;
  /** The IANA zone every day in the ledger is read in. */
  timeZone: string;
}

export type LedgerDto = {
  settings: LedgerSettings;
  createdAt: string;
  updatedAt: string;
};

export type UpdateLedgerActionErrorCode =
  "unsupported_currency" | "validation_failed" | "unexpected";

export type UpdateLedgerActionResult =
  { ok: true; ledger: LedgerDto } | { ok: false; code: UpdateLedgerActionErrorCode };

export type BookDto = {
  id: string;
  name: string;
  sortOrder: number;
  /** Set while the book is retired; the switcher hides those rows. */
  archivedAt: string | null;
};

/** What an API request authenticates as: the key, its ledger and the book it files into. */
export interface AuthenticatedServiceCredential {
  id: string;
  bookId: string;
}

export type ServiceCredentialDto = {
  id: string;
  bookId: string;
  tokenPrefix: string;
  tokenSuffix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  deletedAt: string | null;
};

export type CreatedServiceCredentialDto = ServiceCredentialDto & { token: string };

/**
 * Why a new key was refused. The two conflicts are kept apart: a book that is gone
 * or archived is not the 20-key cap.
 */
export type CreateServiceCredentialErrorCode =
  "book_unavailable" | "limit_reached" | "invalid" | "unexpected";
export type CreateServiceCredentialResult =
  | { ok: true; credential: CreatedServiceCredentialDto }
  | { ok: false; code: CreateServiceCredentialErrorCode };

export type EntryCategoryDto = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type EntryCategoryWithCountDto = EntryCategoryDto & { entryCount: number };

/**
 * `conflict`: the collection changed since the draft was loaded. `assignment_active`:
 * a category run uses one of the categories, so the collection waits for it.
 */
export type SaveEntryCategoriesErrorCode =
  "conflict" | "assignment_active" | "invalid" | "unexpected";
export type SaveEntryCategoriesResult =
  { ok: true; categories: EntryCategoryDto[] } | { ok: false; code: SaveEntryCategoriesErrorCode };

interface SaveEntryCategoryTargetDto {
  id?: string;
  clientId?: string;
  name: string;
  description: string | null;
  icon: string | null;
}

export interface SaveEntryCategoriesInput {
  expectedRevision: string;
  categories: SaveEntryCategoryTargetDto[];
}

export type CategoryAssignmentMode =
  | { kind: "ai"; candidateCategoryIds: string[] }
  | { kind: "assign"; categoryId: string }
  | { kind: "clear" };
export interface StartCategoryAssignmentInput {
  requestKey: string;
  mode: CategoryAssignmentMode;
  ledgerEntryIds: string[];
}
export type CategoryAssignmentJobStatus =
  "pending" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type CategoryAssignmentEntryOutcome =
  "applied" | "confirmed" | "failed" | "conflict" | "skipped" | "cancelled";
export interface CategoryAssignmentCandidateSnapshot {
  id: string;
  name: string;
  description: string | null;
}

/**
 * A category assignment run as the client sees it. Selection rows stay on the
 * server and every v2 entry has one mutually exclusive final outcome.
 */
export interface CategoryAssignmentJobDto {
  id: string;
  mode: CategoryAssignmentMode;
  status: CategoryAssignmentJobStatus;
  /** How many entries the run covers. */
  total: number;
  processedCount: number;
  /** Entries the model actually moved. */
  appliedCount: number;
  /** Entries the model placed in the category they already had. */
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  activeDocumentCount: number;
  retryingDocumentCount: number;
  nextRetryAt: string | null;
  candidateCategories: CategoryAssignmentCandidateSnapshot[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canRetryFailed: boolean;
  evidenceIncomplete: boolean;
}

/** `busy`: another run is active, or the selection changed under the request. */
export type StartCategoryAssignmentErrorCode = "busy" | "invalid" | "unexpected";
export type StartCategoryAssignmentResult =
  | { ok: true; job: CategoryAssignmentJobDto }
  | { ok: false; code: StartCategoryAssignmentErrorCode };

export interface CategoryAssignmentEntryResultDto {
  ledgerEntryId: string;
  itemName: string | null;
  originalCategoryId: string | null;
  originalCategoryName: string | null;
  targetCategoryId: string | null;
  targetCategoryName: string | null;
  outcome: CategoryAssignmentEntryOutcome | null;
  errorCode: string | null;
}
export interface CategoryAssignmentResultPageDto {
  items: CategoryAssignmentEntryResultDto[];
  nextCursor: number | null;
}

/**
 * What the lists show on a run's entries: the ones still waiting for the model
 * and the ones it failed. Everything the run settled is left out.
 */
export interface CategoryAssignmentEntryStatesDto {
  jobId: string;
  pendingIds: string[];
  failedIds: string[];
}

export type SourceDocumentReferenceDto = {
  id: string;
  version: number;
  title: string | null;
  /** The day the record counts on, in the ledger's zone. */
  documentDate: string;
  createdAt: string;
  updatedAt: string;
  hasImages?: boolean;
};

export type LedgerEntryDto = {
  id: string;
  categoryId: string | null;
  sourceDocumentId: string;
  amount: string;
  currency: string;
  itemName: string;
  description: string | null;
  convertedAmount: string | null;
  exchangeRate: string | null;
  createdAt: string;
  updatedAt: string;
  category?: EntryCategoryDto | null;
  sourceDocument?: SourceDocumentReferenceDto | null;
};

export type ActiveLedgerEntryDto = LedgerEntryDto & { sourceDocument: SourceDocumentReferenceDto };

export type LedgerEntryEmbeddedViewDto = Omit<LedgerEntryDto, "sourceDocument">;

export type LedgerSettingsDto = {
  id?: string;
} & LedgerSettings;

export interface LedgerSummaryDto {
  unconvertedCount: number;
  convertedTotal: {
    total: string;
    currency: string;
  } | null;
  totals: {
    currency: string;
    total: string;
    count: number;
  }[];
  trend: {
    date: string;
    total: string;
  }[];
  byCategory: {
    categoryId: string | null;
    /** Null for the entries without a category; the page names them. */
    categoryName: string | null;
    categoryIcon: string | null;
    currency: string | null;
    total: string;
    count: number;
  }[];
}

export interface LedgerEntryPageDto {
  items: ActiveLedgerEntryDto[];
  nextCursor: string | null;
}

export interface LedgerSettingsViewDto {
  uncategorizedCount: number;
  credentials: ServiceCredentialDto[];
}

/** What a date change to the selected entries would move along with them. */
export interface BatchEntryDateImpact {
  selectedEntryCount: number;
  sourceDocumentCount: number;
  affectedEntryCount: number;
  sourceDocumentIds: string[];
}
