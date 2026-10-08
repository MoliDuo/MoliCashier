import { describe, expect, it } from "vitest";
import { buildParserInput } from "@/modules/source-document/domain/parse/parser-prompt";

describe("buildParserInput", () => {
  it("includes categories, text, evidence, aiLanguage, currencies, and custom prompt", () => {
    const firstParseInput = buildParserInput({
      text: "user text",
      evidence: { images: [{ dataUrl: "data:image/jpeg;base64,FAKE" }] },
      aiLanguage: "en-US",
      preferredCurrencies: ["USD"],
      settings: { aiCustomPrompt: "Prefer food-related detail" },
      categories: [{ id: "cat-1", name: "Food", description: null }],
    });

    expect(firstParseInput.text).toBe("user text");
    expect(firstParseInput.evidence).toEqual({
      images: [{ dataUrl: "data:image/jpeg;base64,FAKE" }],
    });
    expect(firstParseInput.aiLanguage).toBe("en-US");
    expect(firstParseInput.preferredCurrencies).toEqual(["USD"]);
    expect(firstParseInput.aiCustomPrompt).toBe("Prefer food-related detail");
    expect(firstParseInput.originalCategories).toEqual([{ name: "Food", description: null }]);
  });
});
