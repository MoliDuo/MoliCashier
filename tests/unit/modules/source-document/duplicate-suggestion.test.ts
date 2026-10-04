import { describe, expect, it } from "vitest";
import { createDuplicateSuggestion } from "@/modules/source-document/duplicate-suggestion";

const targets = new Map([
  ["R1", { ledgerEntryId: "old-1", sourceDocumentId: "doc-old" }],
  ["R2", { ledgerEntryId: "old-2", sourceDocumentId: "doc-old" }],
]);

const entry = (id: string, itemName: string, alreadyRecorded?: string) => ({
  id,
  itemName,
  amount: "9.90",
  currency: "CNY",
  ...(alreadyRecorded === undefined ? {} : { alreadyRecorded }),
});

describe("createDuplicateSuggestion", () => {
  it("is null when no entry was flagged", () => {
    expect(
      createDuplicateSuggestion({ entries: [entry("a", "Cable"), entry("b", "Case")], targets })
    ).toBeNull();
  });

  it("points each flagged entry at the recorded entry and its record", () => {
    const suggestion = createDuplicateSuggestion({
      entries: [entry("a", "Cable", "R2"), entry("b", "Case")],
      targets,
    });

    expect(suggestion).toMatchObject({
      schemaVersion: 1,
      items: [
        {
          ledgerEntryId: "a",
          snapshot: { itemName: "Cable", amount: "9.90", currency: "CNY" },
          matched: { ledgerEntryId: "old-2", sourceDocumentId: "doc-old" },
        },
      ],
    });
    expect(suggestion?.id).toEqual(expect.any(String));
  });

  it("ignores a handle the parse was never given", () => {
    expect(
      createDuplicateSuggestion({ entries: [entry("a", "Cable", "R99")], targets })
    ).toBeNull();
  });

  it("lets one recorded entry account for only one new entry", () => {
    const suggestion = createDuplicateSuggestion({
      entries: [entry("a", "Cable", "R1"), entry("b", "Cable", "R1"), entry("c", "Case", "R2")],
      targets,
    });

    expect(suggestion?.items.map((item) => item.ledgerEntryId)).toEqual(["a", "c"]);
  });
});
