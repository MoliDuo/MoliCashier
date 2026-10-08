/**
 * Compresses an image file on the client side.
 * Uses Web Worker with OffscreenCanvas when available for non-blocking compression.
 */
import { fitImageDimensions } from "./image-dimensions";
import { encodeWithinBudget, type ImageSizeLimits } from "./image-encoding";
import {
  MAX_NORMALIZED_BYTES_PER_FILE,
  NORMALIZED_IMAGE_MAX_HEIGHT,
  NORMALIZED_IMAGE_MAX_PIXELS,
  NORMALIZED_IMAGE_MAX_WIDTH,
} from "./storage/upload-policy";

interface CompressionResult {
  file: File;
  mimeType: string;
}

/** The size the server normalizes a stored image to; compressing to it first saves the upload. */
export const NORMALIZED_IMAGE_LIMITS: ImageSizeLimits = {
  maxWidth: NORMALIZED_IMAGE_MAX_WIDTH,
  maxHeight: NORMALIZED_IMAGE_MAX_HEIGHT,
  maxPixels: NORMALIZED_IMAGE_MAX_PIXELS,
};

class WorkerPool {
  private maxWorkers: number;
  private queue: Array<{
    task: () => Promise<CompressionResult>;
    resolve: (value: CompressionResult) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private activeWorkers = 0;

  constructor(maxWorkers = 3) {
    this.maxWorkers = maxWorkers;
  }

  async execute(task: () => Promise<CompressionResult>): Promise<CompressionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.activeWorkers >= this.maxWorkers || this.queue.length === 0) {
      return;
    }

    const { task, resolve, reject } = this.queue.shift()!;
    this.activeWorkers++;

    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.activeWorkers--;
        this.processQueue();
      });
  }
}

// Create pool instance
const workerPool = new WorkerPool(3);

function createWorker(): Worker | null {
  if (typeof window === "undefined") return null;
  if (typeof OffscreenCanvas === "undefined") return null;

  try {
    return new Worker(new URL("./workers/image-compress.worker.ts", import.meta.url));
  } catch {
    // Worker creation failed, fall back to sync
    return null;
  }
}

/**
 * Re-encodes an image as JPEG within `limits`, keeping its aspect ratio: a long screenshot stays
 * long. The quality steps down from `quality` while the result is over the per-file byte budget.
 */
export async function compressImage(
  file: File,
  limits: ImageSizeLimits = NORMALIZED_IMAGE_LIMITS,
  quality = 0.8,
  signal?: AbortSignal
): Promise<CompressionResult> {
  const maxBytes = MAX_NORMALIZED_BYTES_PER_FILE;
  return workerPool.execute(async () => {
    if (signal?.aborted === true)
      throw new DOMException("Image compression was cancelled", "AbortError");
    const worker = createWorker();

    // Use Web Worker if available (non-blocking)
    if (worker) {
      const arrayBuffer = await file.arrayBuffer();

      return new Promise((resolve, reject) => {
        const cleanup = () => {
          worker.removeEventListener("message", handleMessage);
          worker.removeEventListener("error", handleError);
          signal?.removeEventListener("abort", handleAbort);
          worker.terminate();
        };
        const fail = (error: Error) => {
          cleanup();
          reject(error);
        };
        const handleMessage = (e: MessageEvent) => {
          if (e.data.success === true) {
            cleanup();
            resolve({
              file: new File([e.data.data], file.name, { type: "image/jpeg" }),
              mimeType: "image/jpeg",
            });
          } else {
            fail(new Error(e.data.error));
          }
        };
        const handleError = (event: ErrorEvent) =>
          fail(event.error instanceof Error ? event.error : new Error(event.message));
        const handleAbort = () =>
          fail(new DOMException("Image compression was cancelled", "AbortError"));

        worker.addEventListener("message", handleMessage);
        worker.addEventListener("error", handleError);
        signal?.addEventListener("abort", handleAbort, { once: true });
        worker.postMessage({ imageData: arrayBuffer, limits, quality, maxBytes }, [arrayBuffer]);
      });
    }

    // Fallback to synchronous compression (main thread)
    return compressImageSync(file, limits, quality, maxBytes);
  });
}

/**
 * Synchronous image compression (fallback when Web Worker not available)
 */
function compressImageSync(
  file: File,
  limits: ImageSizeLimits,
  quality: number,
  maxBytes: number
): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const { width, height } = fitImageDimensions(
          img.width,
          img.height,
          limits.maxWidth,
          limits.maxHeight,
          limits.maxPixels
        );

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const encode = (at: number) =>
          new Promise<Blob>((done, fail) =>
            canvas.toBlob(
              (blob) => (blob == null ? fail(new Error("Failed to encode image")) : done(blob)),
              "image/jpeg",
              at
            )
          );
        encodeWithinBudget(encode, quality, maxBytes)
          .then((blob) =>
            resolve({
              file: new File([blob], file.name, { type: "image/jpeg" }),
              mimeType: "image/jpeg",
            })
          )
          .catch(reject);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
