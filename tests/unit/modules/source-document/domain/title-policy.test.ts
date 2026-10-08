import { describe, expect, it } from "vitest";
import {
  MAX_TITLE_LENGTH,
  normalizeTitle,
  TITLE_POLICY_PROMPT,
} from "@/modules/source-document/domain/title-policy";

describe("title-policy", () => {
  it("trims and collapses consecutive whitespace", () => {
    expect(normalizeTitle("  Starbucks \t  Reserve  ", "Untitled")).toBe("Starbucks Reserve");
  });

  it("falls back for null, undefined, empty, and whitespace-only titles", () => {
    expect(normalizeTitle(null, "Untitled document")).toBe("Untitled document");
    expect(normalizeTitle(undefined, "Untitled document")).toBe("Untitled document");
    expect(normalizeTitle("", "Untitled document")).toBe("Untitled document");
    expect(normalizeTitle("   \t\n  ", "Untitled document")).toBe("Untitled document");
  });

  it("truncates overlong titles to 200 code points without splitting surrogate pairs", () => {
    const emoji = "🀄".repeat(150); // 150 code points, 300 UTF-16 units
    const title = `A${"b".repeat(190)}${emoji}`;
    const normalized = normalizeTitle(title, "Untitled");
    expect(Array.from(normalized)).toHaveLength(MAX_TITLE_LENGTH);
    // Truncation must cut between code points, never inside a surrogate pair.
    expect(Array.from(normalized).at(-1)).toBe("🀄");
    expect(normalized.startsWith("A" + "b".repeat(189))).toBe(true);
  });

  it("removes trailing whitespace introduced by truncation", () => {
    const title = `${"x".repeat(MAX_TITLE_LENGTH)}  `;
    const normalized = normalizeTitle(title, "Untitled");
    expect(normalized).toHaveLength(MAX_TITLE_LENGTH);
    expect(normalized.endsWith(" ")).toBe(false);
  });

  it("exposes a prompt that states the default style and instruction priority", () => {
    expect(TITLE_POLICY_PROMPT).toContain("merchant/service-first");
    expect(TITLE_POLICY_PROMPT).toContain("at most 200 Unicode characters");
    expect(TITLE_POLICY_PROMPT).toContain("ledger owner's Additional Instructions");
    expect(TITLE_POLICY_PROMPT).toContain("mandatory output locale below");
  });
});
