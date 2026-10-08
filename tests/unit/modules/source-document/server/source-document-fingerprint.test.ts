import { describe, expect, it } from "vitest";
import { sourceDocumentFingerprint } from "@/modules/source-document/server/source-document-fingerprint";

describe("sourceDocumentFingerprint", () => {
  it("sorts object keys, removes undefined fields, and preserves array order", () => {
    expect(sourceDocumentFingerprint({ b: 2, a: 1, ignored: undefined })).toBe(
      sourceDocumentFingerprint({ a: 1, b: 2 })
    );
    expect(sourceDocumentFingerprint({ values: [1, 2] })).not.toBe(
      sourceDocumentFingerprint({ values: [2, 1] })
    );
    expect(sourceDocumentFingerprint({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});
