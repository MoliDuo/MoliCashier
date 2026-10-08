import { beforeEach, describe, expect, it, vi } from "vitest";

const { compressImageMock } = vi.hoisted(() => ({
  compressImageMock: vi.fn(),
}));

vi.mock("@/lib/image-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-utils")>()),
  compressImage: compressImageMock,
}));

import { loadSourceDocumentInputFiles } from "@/modules/source-document/hooks/source-document-input-images";

describe("source-document input images", () => {
  beforeEach(() => {
    compressImageMock.mockReset();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  });

  it("uses the compressed image when browser decoding succeeds", async () => {
    compressImageMock.mockResolvedValue({
      file: new File([new Uint8Array([1])], "receipt.jpg", { type: "image/jpeg" }),
      mimeType: "image/jpeg",
    });

    const [result] = await loadSourceDocumentInputFiles([
      new File([new Uint8Array([1])], "receipt.png", { type: "image/png" }),
    ]);

    expect(result).toMatchObject({
      kind: "ready",
      image: { data: "blob:preview", mimeType: "image/jpeg", objectUrl: true },
    });
  });

  it("narrows images to the stored width instead of squeezing them into a square", async () => {
    compressImageMock.mockResolvedValue({
      file: new File([new Uint8Array([1])], "receipt.jpg", { type: "image/jpeg" }),
      mimeType: "image/jpeg",
    });

    await loadSourceDocumentInputFiles([
      new File([new Uint8Array([1])], "long-screenshot.png", { type: "image/png" }),
    ]);

    expect(compressImageMock.mock.calls[0]?.[1]).toEqual({
      maxWidth: 1440,
      maxHeight: 16_383,
      maxPixels: 16_000_000,
    });
  });

  it("rejects unsupported originals when browser compression fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    compressImageMock.mockRejectedValue(new Error("decode failed"));

    await expect(
      loadSourceDocumentInputFiles([
        new File([new Uint8Array([1])], "receipt.heic", { type: "image/heic" }),
      ])
    ).resolves.toEqual([{ kind: "unsupported", fileName: "receipt.heic" }]);
  });

  it("starts all selected image conversions before any one resolves", async () => {
    const resolvers: Array<(value: { file: File; mimeType: string }) => void> = [];
    compressImageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const files = ["first.png", "second.png", "third.png"].map(
      (name) => new File([new Uint8Array([1])], name, { type: "image/png" })
    );

    const loading = loadSourceDocumentInputFiles(files);
    expect(compressImageMock).toHaveBeenCalledTimes(3);

    resolvers.forEach((resolve, index) =>
      resolve({
        file: new File([new Uint8Array([index + 1])], `receipt-${index}.jpg`, {
          type: "image/jpeg",
        }),
        mimeType: "image/jpeg",
      })
    );
    const results = await loading;

    expect(results.map((result) => result.kind)).toEqual(["ready", "ready", "ready"]);
  });
});
