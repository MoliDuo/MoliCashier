import { describe, expect, it } from "vitest";
import {
  INVALID_REASON_PROMPT,
  MAX_FAILURE_REASON_LENGTH,
  normalizeFailureReason,
} from "@/modules/source-document/domain/failure-reason-policy";

describe("failure-reason-policy", () => {
  it("trims and collapses consecutive whitespace", () => {
    expect(normalizeFailureReason("  This is a refund, \n\t not an expense.  ")).toBe(
      "This is a refund, not an expense."
    );
  });

  it("returns null for null, undefined, empty, and whitespace-only reasons", () => {
    expect(normalizeFailureReason(null)).toBeNull();
    expect(normalizeFailureReason(undefined)).toBeNull();
    expect(normalizeFailureReason("")).toBeNull();
    expect(normalizeFailureReason("   \t\n  ")).toBeNull();
  });

  it("turns control characters into separators and drops invisible format marks", () => {
    expect(normalizeFailureReason("Unread\u0000able\u200b total")).toBe("Unread able total");
  });

  it("truncates overlong reasons to 300 code points without splitting surrogate pairs", () => {
    const emoji = "🀄".repeat(150); // 150 code points, 300 UTF-16 units
    const reason = `A${"b".repeat(290)}${emoji}`;
    const normalized = normalizeFailureReason(reason);
    expect(normalized).not.toBeNull();
    expect(Array.from(normalized!)).toHaveLength(MAX_FAILURE_REASON_LENGTH);
    // Truncation must cut between code points, never inside a surrogate pair.
    expect(Array.from(normalized!).at(-1)).toBe("🀄");
    expect(normalized!.startsWith("A" + "b".repeat(289))).toBe(true);
  });

  it("removes trailing whitespace introduced by truncation", () => {
    const normalized = normalizeFailureReason("x".repeat(MAX_FAILURE_REASON_LENGTH) + "   ");
    expect(normalized).toHaveLength(MAX_FAILURE_REASON_LENGTH);
    expect(normalized!.endsWith(" ")).toBe(false);
  });

  it("exposes a prompt written for the ledger owner, not for the pipeline", () => {
    expect(INVALID_REASON_PROMPT).toContain("invalid_reason");
    expect(INVALID_REASON_PROMPT).toContain("non-technical person");
    expect(INVALID_REASON_PROMPT).toContain("At most 200 Unicode characters");
    expect(INVALID_REASON_PROMPT).toContain("No field names");
  });
});
