import { describe, expect, it } from "vitest";
import { buildSourceDocumentRetrySeed } from "@/modules/source-document/ui/source-document-retry-seed";

describe("source document retry seed", () => {
  it("uses stored-file URLs while preserving file identity order", () => {
    const seed = buildSourceDocumentRetrySeed(
      { id: "doc-1", latestAttemptId: null, text: "fallback", files: [], hasImages: true },
      {
        text: "receipt",
        documentDate: "2026-09-10",
        files: [
          { id: "file-2", contentType: "image/png", byteSize: 2, originalFilename: null },
          { id: "file-1", contentType: "image/jpeg", byteSize: 1, originalFilename: null },
        ],
      }
    );

    expect(seed.images).toEqual([
      { data: "/api/stored-files/file-2", mimeType: "image/png", storedFileId: "file-2" },
      { data: "/api/stored-files/file-1", mimeType: "image/jpeg", storedFileId: "file-1" },
    ]);
    expect(JSON.stringify(seed)).not.toContain("/api/uploads/");
    expect(JSON.stringify(seed)).not.toContain("storageKey");
  });

  it("prefers the date the input read returns over the one the list row carried", () => {
    const seed = buildSourceDocumentRetrySeed(
      { id: "doc-1", latestAttemptId: null, documentDate: "2026-08-01" },
      { text: "retried receipt", files: [], documentDate: "2026-09-10" }
    );

    expect(seed.entryDate).toBe("2026-09-10");
  });

  it("falls back to the record's date when the input read has none", () => {
    const seed = buildSourceDocumentRetrySeed(
      { id: "doc-1", latestAttemptId: null, documentDate: "2026-08-01" },
      { text: "retried receipt", files: [], documentDate: null }
    );

    expect(seed.entryDate).toBe("2026-08-01");
  });
});
