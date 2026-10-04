/**
 * Shared AI title policy.
 *
 * The parser applies the same default style and normalization rules so ledger
 * prompts cannot bypass the hard non-empty/length constraints.
 */

/** Hard maximum length for a persisted title, in Unicode code points. */
export const MAX_TITLE_LENGTH = 200;

/**
 * Normalize an AI-produced title: trim, collapse consecutive whitespace,
 * fall back when empty, and truncate at MAX_TITLE_LENGTH code points without
 * splitting surrogate pairs. Trailing whitespace introduced by truncation is
 * removed again.
 */
export function normalizeTitle(raw: string | null | undefined, fallback: string): string {
  const collapsed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (collapsed === "") return fallback;
  const truncated = Array.from(collapsed).slice(0, MAX_TITLE_LENGTH).join("");
  return truncated.trim();
}

/**
 * Prompt section stating the default title style and the instruction
 * priority. Highest priority is document facts and hard constraints; the
 * mandatory output locale comes second, the ledger owner's Additional
 * Instructions third, and the default merchant/service-first style last.
 */
export const TITLE_POLICY_PROMPT = `### Title
Concise merchant/service-first title (e.g. "Starbucks", "Didi ride"). Add a qualifier only if needed to disambiguate from other documents. No amounts, dates, or payment status. Non-empty, at most 200 Unicode characters.
Priority (highest first): 1) facts/structure of the source document (title still non-empty, ≤200 chars) 2) the mandatory output locale below 3) ledger owner's Additional Instructions 4) Learned Preferences 5) the default style above.`;
