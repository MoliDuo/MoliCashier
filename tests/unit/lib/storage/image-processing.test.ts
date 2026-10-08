/**
 * Image Processing Utilities Tests
 */

import { describe, it, expect } from "vitest";
import {
  processImage,
  isSupportedImageFormat,
  getImageDimensions,
  planImageParts,
  prepareStoredImageForAI,
} from "@/lib/storage/image-processing";
import sharp from "sharp";

describe("image-processing", () => {
  // Create a simple test image buffer
  async function createTestImage(
    width: number,
    height: number,
    format: "jpeg" | "png" | "webp" = "jpeg"
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .toFormat(format)
      .toBuffer();

    const mimeTypes = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };

    return { buffer, mimeType: mimeTypes[format] };
  }

  describe("processImage", () => {
    it("should compress JPEG image", async () => {
      const { buffer, mimeType } = await createTestImage(1000, 1000, "jpeg");

      const result = await processImage(buffer, mimeType);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.mimeType).toBe("image/webp"); // Converts to WebP by default
    });

    it("should keep PNG format for transparency", async () => {
      const { buffer, mimeType } = await createTestImage(500, 500, "png");

      const result = await processImage(buffer, mimeType);

      expect(result.mimeType).toBe("image/png"); // PNGs stay as PNG
    });

    it("narrows a wide photo to the normalized width", async () => {
      const { buffer, mimeType } = await createTestImage(3000, 2000, "jpeg");

      const result = await processImage(buffer, mimeType);

      await expect(getImageDimensions(result.buffer)).resolves.toEqual({
        width: 1440,
        height: 960,
      });
    });

    it("keeps a long screenshot long instead of fitting it in a square", async () => {
      const { buffer, mimeType } = await createTestImage(1080, 9000, "jpeg");

      const result = await processImage(buffer, mimeType);

      await expect(getImageDimensions(result.buffer)).resolves.toEqual({
        width: 1080,
        height: 9000,
      });
    });

    it("keeps a very long screenshot within WebP's height and the pixel budget", async () => {
      const { buffer, mimeType } = await createTestImage(1440, 20000, "jpeg");

      const result = await processImage(buffer, mimeType);

      const dimensions = await getImageDimensions(result.buffer);
      expect(dimensions!.height).toBeLessThanOrEqual(16_383);
      expect(dimensions!.width * dimensions!.height).toBeLessThanOrEqual(16_000_000);
      // The aspect ratio survives the shrink.
      expect(dimensions!.height / dimensions!.width).toBeCloseTo(20000 / 1440, 1);
    });

    it("should not enlarge small images", async () => {
      const { buffer, mimeType } = await createTestImage(100, 100, "jpeg");

      const result = await processImage(buffer, mimeType);

      const dimensions = await getImageDimensions(result.buffer);
      expect(dimensions?.width).toBe(100);
      expect(dimensions?.height).toBe(100);
    });

    it("should convert to specified format", async () => {
      const { buffer, mimeType } = await createTestImage(500, 500, "jpeg");

      const result = await processImage(buffer, mimeType, {
        format: "png",
      });

      expect(result.mimeType).toBe("image/png");
    });

    it("should adjust quality", async () => {
      const { buffer, mimeType } = await createTestImage(1000, 1000, "jpeg");

      const highQuality = await processImage(buffer, mimeType, {
        quality: 90,
        format: "jpeg",
      });

      const lowQuality = await processImage(buffer, mimeType, {
        quality: 50,
        format: "jpeg",
      });

      // Lower quality should generally produce smaller file (though not guaranteed)
      expect(lowQuality.buffer.length).toBeLessThanOrEqual(
        highQuality.buffer.length + 1000 // Allow small margin
      );
    });

    it("should throw on invalid buffer instead of returning original bytes", async () => {
      const invalidBuffer = Buffer.from("not an image");

      await expect(processImage(invalidBuffer, "image/jpeg")).rejects.toThrow(Error);
    });

    it("should return processed output even if larger than original", async () => {
      // Create a very small compressed image
      const buffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .jpeg({ quality: 1 })
        .toBuffer();

      const result = await processImage(buffer, "image/jpeg");

      // Should return processed buffer (not the original fallback)
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  describe("isSupportedImageFormat", () => {
    it("accepts upload image formats case-insensitively and rejects other content", () => {
      for (const mime of [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
        "IMAGE/JPEG",
        "Image/Png",
      ]) {
        expect(isSupportedImageFormat(mime)).toBe(true);
      }
      for (const mime of [
        "application/pdf",
        "text/plain",
        "image/svg+xml",
        "image/jpg",
        "image/tiff",
      ]) {
        expect(isSupportedImageFormat(mime)).toBe(false);
      }
    });
  });

  describe("planImageParts", () => {
    it("leaves an image no taller than twice its width whole", () => {
      expect(planImageParts(1000, 2000)).toBeNull();
      expect(planImageParts(2000, 1000)).toBeNull();
    });

    it("cuts a tall image into overlapping parts no taller than twice its width", () => {
      const plan = planImageParts(1440, 11_000)!;

      expect(plan.partHeight).toBe(2880);
      expect(plan.tops[0]).toBe(0);
      expect(plan.tops.at(-1)! + plan.partHeight).toBe(11_000);
      expect(plan.overlapPx).toBeGreaterThanOrEqual(288);
      for (let index = 1; index < plan.tops.length; index += 1) {
        expect(plan.tops[index - 1]! + plan.partHeight - plan.tops[index]!).toBeGreaterThanOrEqual(
          plan.overlapPx
        );
      }
    });

    it("cuts a very long, narrow image into at most eight taller parts", () => {
      const plan = planImageParts(300, 16_000)!;

      expect(plan.tops).toHaveLength(8);
      expect(plan.tops.at(-1)! + plan.partHeight).toBe(16_000);
      expect(plan.overlapPx).toBeGreaterThan(0);
    });
  });

  describe("prepareStoredImageForAI", () => {
    it("passes an ordinary image on as stored", async () => {
      const { buffer } = await createTestImage(20, 20, "png");

      await expect(prepareStoredImageForAI(buffer, "image/png")).resolves.toEqual({
        contentType: "image/png",
        parts: [buffer],
        overlapPx: 0,
      });
    });

    it("cuts a tall screenshot into parts of the same width that cover it top to bottom", async () => {
      const { buffer } = await createTestImage(400, 2000, "webp");

      const prepared = await prepareStoredImageForAI(buffer, "image/webp");

      expect(prepared.contentType).toBe("image/webp");
      expect(prepared.parts.length).toBe(Math.ceil((2000 - 80) / (800 - 80)));
      expect(prepared.overlapPx).toBeGreaterThanOrEqual(80);
      for (const part of prepared.parts) {
        await expect(getImageDimensions(part)).resolves.toEqual({ width: 400, height: 800 });
      }
    });

    it("rejects malformed bytes and declared MIME mismatches", async () => {
      await expect(
        prepareStoredImageForAI(Buffer.from("not-an-image"), "image/jpeg")
      ).rejects.toThrow(Error);
      const { buffer } = await createTestImage(20, 20, "png");
      await expect(prepareStoredImageForAI(buffer, "image/jpeg")).rejects.toThrow("does not match");
    });

    it("rejects a file whose header is fine but whose image data is cut short", async () => {
      const { buffer } = await createTestImage(400, 400, "png");

      await expect(
        prepareStoredImageForAI(buffer.subarray(0, buffer.length / 2), "image/png")
      ).rejects.toThrow(Error);
    });
  });

  describe("getImageDimensions", () => {
    it("should return dimensions for valid image", async () => {
      const { buffer } = await createTestImage(800, 600, "jpeg");

      const dimensions = await getImageDimensions(buffer);

      expect(dimensions).toEqual({ width: 800, height: 600 });
    });

    it("should return null for invalid buffer", async () => {
      const invalidBuffer = Buffer.from("not an image");

      const dimensions = await getImageDimensions(invalidBuffer);

      expect(dimensions).toBeNull();
    });
  });
});
