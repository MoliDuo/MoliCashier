/**
 * Shared AI failure-reason policy.
 *
 * A document that could not be parsed records one reason: a short, localized
 * sentence written for the ledger owner. It is rendered verbatim, so it must
 * be sanitized and bounded before persistence.
 */

/** Hard maximum length for a persisted failure reason, in Unicode code points. */
export const MAX_FAILURE_REASON_LENGTH = 300;

/**
 * Normalize an AI-produced failure reason: strip control and format
 * characters, collapse consecutive whitespace, truncate at
 * MAX_FAILURE_REASON_LENGTH code points without splitting surrogate pairs, and
 * return null when nothing readable remains. Unlike a title there is no
 * fallback: the UI supplies localized copy when no reason was written.
 */
export function normalizeFailureReason(raw: string | null | undefined): string | null {
  const stripped = (raw ?? "")
    // Control characters separate words; formatting marks (zero-width spaces,
    // bidi controls) are invisible and must not leave a gap behind.
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\p{Cf}+/gu, "");
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return Array.from(collapsed).slice(0, MAX_FAILURE_REASON_LENGTH).join("").trim();
}

/**
 * Prompt section describing the failure reason the ledger owner reads when a
 * document yields no entries. It must explain the document, not the pipeline.
 */
export const INVALID_REASON_PROMPT = `### Invalid reason
When outcome is "invalid", invalid_reason is the only explanation the ledger owner sees, so write one plain sentence for a non-technical person about why no expense could be recorded from this document (for example a refund or credit note, an unreadable image, or a document without a purchase amount). Describe the document itself: never the parsing pipeline. No field names, enum values, JSON, error codes, or internal terms. At most 200 Unicode characters.`;
