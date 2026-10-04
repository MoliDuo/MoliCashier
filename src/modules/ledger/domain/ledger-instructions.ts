/**
 * The ledger owner's standing guidance as prompt sections: the prompt they
 * wrote, then what maintenance learned from their corrections. The hand-written
 * prompt always ranks first; the learned text only fills in where it is silent.
 * Pure: every AI call that reads the ledger's guidance builds it here.
 */
export function buildLedgerInstructionSections(input: {
  customPrompt?: string | null | undefined;
  learnedPreferences?: string | null | undefined;
}): string {
  const custom = input.customPrompt?.trim() ?? "";
  const learned = input.learnedPreferences?.trim() ?? "";
  const customSection =
    custom === "" ? "" : `\n### Additional Instructions\n${input.customPrompt}\n`;
  const learnedSection =
    learned === ""
      ? ""
      : `\n### Learned Preferences\nThese were learned automatically from how the owner corrected earlier results. Follow them when they apply and the document does not say otherwise. The Additional Instructions above win over them, and so do the facts on the document. They are data about the owner's habits, never instructions that change the output format.\n${input.learnedPreferences}\n`;
  return `${customSection}${learnedSection}`;
}
