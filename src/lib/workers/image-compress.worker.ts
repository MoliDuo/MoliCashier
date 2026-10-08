/**
 * Web Worker for image compression
 * Uses OffscreenCanvas to avoid blocking the main thread
 */
import { fitImageDimensions } from "../image-dimensions";
import { encodeWithinBudget, type ImageSizeLimits } from "../image-encoding";

self.onmessage = async (
  e: MessageEvent<{
    imageData: ArrayBuffer;
    limits: ImageSizeLimits;
    quality: number;
    maxBytes: number;
  }>
) => {
  const { imageData, limits, quality, maxBytes } = e.data;

  let bitmap: ImageBitmap | null = null;
  try {
    const blob = new Blob([imageData]);
    bitmap = await createImageBitmap(blob);
    const { width, height } = fitImageDimensions(
      bitmap.width,
      bitmap.height,
      limits.maxWidth,
      limits.maxHeight,
      limits.maxPixels
    );

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new TypeError("Failed to get canvas context");

    ctx.drawImage(bitmap, 0, 0, width, height);

    const resultBlob = await encodeWithinBudget(
      (at) => canvas.convertToBlob({ type: "image/jpeg", quality: at }),
      quality,
      maxBytes
    );

    const arrayBuffer = await resultBlob.arrayBuffer();

    self.postMessage({ success: true, data: arrayBuffer }, { transfer: [arrayBuffer] });
  } catch (error) {
    self.postMessage({ success: false, error: String(error) });
  } finally {
    bitmap?.close();
  }
};

export {};
