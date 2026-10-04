import { describe, expect, it } from "vitest";
import { buildLedgerInstructionSections } from "@/modules/ledger/domain/ledger-instructions";

describe("buildLedgerInstructionSections", () => {
  it("is empty when the ledger has neither", () => {
    expect(buildLedgerInstructionSections({})).toBe("");
    expect(buildLedgerInstructionSections({ customPrompt: "  ", learnedPreferences: "" })).toBe("");
  });

  it("writes the hand-written prompt on its own", () => {
    const sections = buildLedgerInstructionSections({ customPrompt: "星巴克算餐饮" });

    expect(sections).toContain("### Additional Instructions\n星巴克算餐饮");
    expect(sections).not.toContain("Learned Preferences");
  });

  it("writes the learned preferences after the prompt and ranks them below it", () => {
    const sections = buildLedgerInstructionSections({
      customPrompt: "星巴克算餐饮",
      learnedPreferences: "- 滴滴算交通",
    });

    expect(sections.indexOf("### Additional Instructions")).toBeLessThan(
      sections.indexOf("### Learned Preferences")
    );
    expect(sections).toContain("- 滴滴算交通");
    expect(sections).toContain("The Additional Instructions above win over them");
  });

  it("writes the learned preferences alone when there is no prompt", () => {
    const sections = buildLedgerInstructionSections({ learnedPreferences: "- 滴滴算交通" });

    expect(sections).not.toContain("### Additional Instructions");
    expect(sections).toContain("### Learned Preferences");
  });
});
