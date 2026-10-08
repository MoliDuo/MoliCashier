import type { SourceDocumentSubmissionContract } from "@/modules/source-document/server/submissions";
import type { CredentialDocumentStatus } from "@/modules/source-document/lifecycle";

export interface ApiV1SourceDocumentCreateResponse {
  sourceDocumentId: string;
  /**
   * Public name of the extraction attempt the request queued. A replayed
   * request reports the record's latest one, or null if it has none.
   */
  revisionId: string | null;
  /** "processing" for a new record; a replay reports the record's current status. */
  revisionState: CredentialDocumentStatus;
  status: CredentialDocumentStatus;
}

export const apiV1Compatibility = {
  version: "v1",
  status: "stable",
} as const;

export function toApiV1SourceDocumentCreateResponse(
  result: SourceDocumentSubmissionContract
): ApiV1SourceDocumentCreateResponse {
  return {
    sourceDocumentId: result.sourceDocumentId,
    revisionId: result.attemptId,
    revisionState: result.processingStatus,
    status: result.processingStatus,
  };
}
