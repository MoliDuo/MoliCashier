import { describe, expect, it } from "vitest";
import { toEvidenceImage } from "@/lib/ai/evidence-images";

describe("toEvidenceImage", () => {
  it("sends an image prepared whole as one data URL", () => {
    expect(
      toEvidenceImage({ contentType: "image/png", parts: [Buffer.from("whole")], overlapPx: 0 })
    ).toEqual({ dataUrl: `data:image/png;base64,${Buffer.from("whole").toString("base64")}` });
  });

  it("sends a cut screenshot as its parts, in order, with their overlap", () => {
    expect(
      toEvidenceImage({
        contentType: "image/webp",
        parts: [Buffer.from("top"), Buffer.from("bottom")],
        overlapPx: 24,
      })
    ).toEqual({
      parts: [
        `data:image/webp;base64,${Buffer.from("top").toString("base64")}`,
        `data:image/webp;base64,${Buffer.from("bottom").toString("base64")}`,
      ],
      overlapPx: 24,
    });
  });
});
