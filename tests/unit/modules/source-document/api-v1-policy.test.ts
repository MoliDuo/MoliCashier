import { describe, expect, it } from "vitest";
import { decodeBase64Image } from "@/modules/source-document/api-v1-policy";

describe("decodeBase64Image", () => {
  it("normalizes raw, whitespace, data URL, and omitted padding representations", () => {
    const expected = Buffer.from("hello");
    for (const data of ["aGVsbG8=", "aGVs\n bG8=", "aGVsbG8", "data:image/jpeg;base64,aGVsbG8="]) {
      expect(decodeBase64Image(data, "image/jpeg").bytes).toEqual(expected);
    }
  });

  it.each([
    ["", "empty"],
    ["a", "invalid length"],
    ["aGVsbG8===", "padding"],
    ["aGV=sbG8", "embedded padding"],
    ["aGVsbG8!", "invalid character"],
  ])("rejects %s (%s)", (data) => {
    expect(() => decodeBase64Image(data, "image/jpeg")).toThrow();
  });

  it("rejects a mismatched data URL MIME type", () => {
    expect(() => decodeBase64Image("data:image/png;base64,aGVsbG8=", "image/jpeg")).toThrow(
      "MIME type does not match"
    );
  });
});
