/** Pure lifecycle rules for source documents, shared by server and client code. */

export type AttemptProcessingStatus = "processing" | "completed" | "failed" | "cancelled";
export type AttemptFailureKind = "invalid_input" | "processing_error";

/** What API v1 reports for a record. */
export type CredentialDocumentStatus =
  "processing" | "completed" | "invalid" | "failed" | "cancelled";

/**
 * The status of a record's latest parse as API v1 reports it: an unreadable
 * input is "invalid", and a record with no parse (entered or split off by
 * hand) is "completed".
 */
export function toCredentialDocumentStatus(
  attempt: { status: AttemptProcessingStatus; failureKind: AttemptFailureKind | null } | null
): CredentialDocumentStatus {
  if (attempt == null) return "completed";
  return attempt.failureKind === "invalid_input" ? "invalid" : attempt.status;
}

export type SupportedSourceDocumentAction =
  "retry" | "edit_retry" | "delete" | "cancel_processing" | "split_entries";

export function supportedSourceDocumentActions(input: {
  latestAttemptStatus: AttemptProcessingStatus | null;
  hasSubmissionInput: boolean;
  deleted?: boolean;
}): readonly SupportedSourceDocumentAction[] {
  if (input.deleted) {
    return [];
  }

  if (input.latestAttemptStatus === "processing") {
    return ["cancel_processing", "retry", "edit_retry", "delete"];
  }

  const retryActions: SupportedSourceDocumentAction[] = input.hasSubmissionInput
    ? ["retry", "edit_retry"]
    : [];
  return ["split_entries", ...retryActions, "delete"];
}

/**
 * Stable, user-facing processing failure codes for documents that failed to parse.
 * These are localized and sanitized before being shown in the UI.
 */
export const PROCESSING_FAILURE_CODES = [
  "ai_provider_unavailable",
  "ai_schema_invalid",
  "exchange_rate_failure",
  "storage_failure",
  "processing_unavailable",
  "request_bound_retry_exhausted",
  "processing_timeout",
] as const;
export type ProcessingFailureCode = (typeof PROCESSING_FAILURE_CODES)[number];

/**
 * The public code for a stored processing failure. Anything outside the stable
 * set, including a missing code, is reported as "processing_unavailable".
 */
export function toStableFailureCode(code: string | null | undefined): ProcessingFailureCode {
  return (PROCESSING_FAILURE_CODES as readonly string[]).includes(code ?? "")
    ? (code as ProcessingFailureCode)
    : "processing_unavailable";
}
