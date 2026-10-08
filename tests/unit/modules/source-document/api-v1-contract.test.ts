import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiV1IdempotencyKeySchema,
  createSourceDocumentInputSchema,
  createSourceDocumentInputSchemaV1,
  retrySourceDocumentInputSchema,
} from "@/modules/source-document/contract-schemas";
import {
  API_V1_MAX_DECODED_BATCH_BYTES,
  API_V1_MAX_DECODED_IMAGE_BYTES,
} from "@/modules/source-document/api-v1-policy";

const decodeBase64ImageMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/source-document/api-v1-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/source-document/api-v1-policy")>()),
  decodeBase64Image: decodeBase64ImageMock,
}));

const image = { data: "AQ==", mimeType: "image/jpeg" };

describe("API v1 source-document contract", () => {
  beforeEach(() => {
    decodeBase64ImageMock.mockReset();
    decodeBase64ImageMock.mockImplementation((data: string) => {
      const encoded = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
      const bytes = Buffer.from(encoded.replace(/[\t\n\f\r ]+/g, ""), "base64");
      if (bytes.length === 0) throw new Error("Image data is empty");
      return { bytes, normalizedBase64: encoded };
    });
  });

  it.each([
    ["2024-02-29", "2024-02-29"],
    ["2026-07-27T23:30:00+08:00", "2026-07-27"],
    ["2026-07-27T00:30:00-07:00", "2026-07-27"],
    ["2026-07-27T12:00:00Z", "2026-07-27"],
  ])("accepts %s and normalizes to %s", (entryDate, expected) => {
    expect(createSourceDocumentInputSchemaV1.parse({ images: [image], entryDate }).entryDate).toBe(
      expected
    );
  });

  it.each([
    "2023-02-29",
    "2026-02-30",
    "2026-07-27T12:00:00",
    "07/27/2026",
    "2026-07-27T24:00:00Z",
  ])("rejects invalid or timezone-less date %s", (entryDate) => {
    expect(() => createSourceDocumentInputSchemaV1.parse({ images: [image], entryDate })).toThrow();
  });

  it("decodes each image exactly once and retains only bytes, MIME, and hash", () => {
    const parsed = createSourceDocumentInputSchemaV1.parse({
      images: [
        { data: "AQ==", mimeType: "image/jpeg" },
        { data: "data:image/png;base64,aGVsbG8=", mimeType: "image/png" },
      ],
    });

    expect(decodeBase64ImageMock).toHaveBeenCalledTimes(2);
    expect(parsed.images).toHaveLength(2);
    for (const prepared of parsed.images) {
      expect("data" in prepared).toBe(false);
      expect(prepared.bytes).toBeInstanceOf(Buffer);
      expect(prepared.mimeType).toMatch(/^image\/(jpeg|png)$/);
      expect(prepared.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(parsed.images[1]?.contentHash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("rejects an image whose decoded size exceeds the per-image limit", () => {
    const oversized = Buffer.alloc(API_V1_MAX_DECODED_IMAGE_BYTES + 1).toString("base64");
    const result = createSourceDocumentInputSchemaV1.safeParse({
      images: [{ data: oversized, mimeType: "image/jpeg" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "images.0.data")).toBe(
        true
      );
    }
  });

  it("rejects a batch whose total decoded size exceeds the batch limit", () => {
    const half = Buffer.alloc(API_V1_MAX_DECODED_BATCH_BYTES / 2 + 1).toString("base64");
    const result = createSourceDocumentInputSchemaV1.safeParse({
      images: [
        { data: half, mimeType: "image/jpeg" },
        { data: half, mimeType: "image/jpeg" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message.includes("batch exceeds 24 MiB"))
      ).toBe(true);
    }
  });

  it("rejects legacy inline image fields at browser action boundaries", () => {
    const legacyImages = { images: [image], text: "receipt" };
    const legacyOriginals = { originalImages: [image], text: "receipt" };
    expect(createSourceDocumentInputSchema.safeParse(legacyImages).success).toBe(false);
    expect(createSourceDocumentInputSchema.safeParse(legacyOriginals).success).toBe(false);
    expect(retrySourceDocumentInputSchema.safeParse(legacyImages).success).toBe(false);
    expect(retrySourceDocumentInputSchema.safeParse(legacyOriginals).success).toBe(false);
  });

  describe("apiV1IdempotencyKeySchema", () => {
    it("accepts boundary lengths without transforming legal content", () => {
      expect(apiV1IdempotencyKeySchema.parse("a")).toBe("a");
      const key = "x".repeat(512);
      expect(apiV1IdempotencyKeySchema.parse(key)).toBe(key);
      expect(apiV1IdempotencyKeySchema.parse("  spaced-key  ")).toBe("  spaced-key  ");
      expect(apiV1IdempotencyKeySchema.parse("MiXeD-CaSe-Key")).toBe("MiXeD-CaSe-Key");
    });

    it("rejects empty, whitespace-only, and oversized keys", () => {
      for (const key of ["", " \t\n ", "x".repeat(513)]) {
        expect(apiV1IdempotencyKeySchema.safeParse(key).success).toBe(false);
      }
    });
  });
});
