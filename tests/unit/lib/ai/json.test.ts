import { describe, expect, it } from "vitest";
import { buildRepairPrompt, extractJson } from "@/lib/ai/json";

describe("JSON response utilities", () => {
  it("removes markdown fences and surrounding whitespace", () => {
    expect(extractJson('  ```json\n{"key":"value"}\n```  ')).toBe('{"key":"value"}');
    expect(extractJson('  ```\n{"key":"value"}\n```  ')).toBe('{"key":"value"}');
  });

  it("extracts outer JSON objects and arrays from model prose", () => {
    expect(extractJson('Result: {"outer":{"value":1}} done')).toBe('{"outer":{"value":1}}');
    expect(extractJson("Result: [1,2,3] done")).toBe("[1,2,3]");
  });

  it("leaves plain model content available for the repair path", () => {
    expect(extractJson("  no structured result  ")).toBe("no structured result");
  });

  it("builds repair instructions that carry the content and each problem", () => {
    const malformed = '{"broken": value}';
    const prompt = buildRepairPrompt(malformed, [
      "The reply is not valid JSON.",
      "icon: Invalid option",
    ]);
    expect(prompt).toContain(malformed);
    expect(prompt).toContain("JSON repair");
    expect(prompt).toContain("- The reply is not valid JSON.");
    expect(prompt).toContain("- icon: Invalid option");
  });

  it("asks for a conversion when the reply was prose with no JSON in it", () => {
    const prompt = buildRepairPrompt("plain response", ["The reply is not valid JSON."]);
    expect(prompt).toContain("plain response");
    expect(prompt).toContain("natural language");
    expect(prompt).not.toContain("was expected to be valid but is not usable");
  });
});
