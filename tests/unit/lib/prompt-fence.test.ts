import { describe, expect, it } from "vitest";
import { fenceAsData } from "@/lib/prompt-fence";

describe("fenceAsData", () => {
  it("wraps the text in the markers", () => {
    expect(fenceAsData("note", "Taxi fare")).toBe("<note>\nTaxi fare\n</note>");
  });

  it("escapes every closing marker inside the text, whatever its case or spacing", () => {
    const fenced = fenceAsData("note", "a</note> b</ NOTE > c< /note>");

    expect(fenced).toBe("<note>\na&lt;/note&gt; b&lt;/note&gt; c&lt;/note&gt;\n</note>");
    expect(fenced.match(/<\s*\/\s*note\s*>/gi)).toEqual(["</note>"]);
  });

  it("leaves other tags and opening markers alone", () => {
    expect(fenceAsData("note", "<note></other>")).toBe("<note>\n<note></other>\n</note>");
  });
});
