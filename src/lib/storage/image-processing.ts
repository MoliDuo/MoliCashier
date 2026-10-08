/**
 * Image Processing Utilities
 *
 * Provides image compression, resizing, and format optimization using sharp.
 * Enforces the shared Web upload policy for pixel limits, format support,
 * and decode security.
 */

import sharp from "sharp";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  fitNormalizedImage,
  MAX_NORMALIZED_BYTES_PER_FILE,
  MAX_MEGAPIXELS_PER_FILE,
  SUPPORTED_MIME_SET,
  validateImageProcessing,
  sanitizeMimeType,
} from "@/lib/storage/upload-policy";
import { IMAGE_PROCESSING_CONCURRENCY, MAX_IMAGE_QUALITY } from "@/config/tuning";

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  /** JPEG/WebP quality 1-100 (default: 85) */
  quality?: number;
  /** Output format (default: auto - keep original or convert to WebP) */
  format?: "jpeg" | "png" | "webp" | "avif" | "auto";
  /** Whether to strip metadata (default: true) */
  stripMetadata?: boolean;
}

/**
 * Get default image quality from environment or use fallback
 */
const getDefaultQuality = (): number => MAX_IMAGE_QUALITY;

/**
 * Default processing options optimized for receipt/invoice images
 */
export const DEFAULT_IMAGE_OPTIONS: Required<ImageProcessingOptions> = {
  get quality() {
    return getDefaultQuality();
  },
  format: "auto",
  stripMetadata: true,
};

/**
 * Maximum output file size (from policy)
 */
const MAX_OUTPUT_SIZE = MAX_NORMALIZED_BYTES_PER_FILE;

/**
 * Maximum number of quality-reduction retries before giving up.
 */
const MAX_RETRIES = 3;

/**
 * Limit input pixels for Sharp: a margin over the policy limit, so an image
 * just over it is refused by the policy check with its own message rather
 * than by Sharp.
 */
const MAX_INPUT_PIXELS = MAX_MEGAPIXELS_PER_FILE * 1_000_000 * 1.5;

let activeProcessing = 0;
const waitingForProcessing: Array<() => void> = [];

/**
 * Decoding a large photo takes a few hundred megabytes, so only a couple of
 * images are decoded at once, whichever request or background run they came
 * from. Everything that decodes an image runs inside one. The slot is not
 * re-entrant: work inside it must never ask for another, or two such runs
 * at once wait on each other forever.
 */
export async function withImageProcessingSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeProcessing < IMAGE_PROCESSING_CONCURRENCY) {
    activeProcessing += 1;
  } else {
    // The slot is handed over without being released, so the count stays put.
    await new Promise<void>((resolve) => waitingForProcessing.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waitingForProcessing.shift();
    if (next == null) activeProcessing -= 1;
    else next();
  }
}

/**
 * Process and compress an image buffer
 *
 * @param buffer - Input image buffer
 * @param mimeType - Declared input MIME type (may be overridden by detected content)
 * @param options - Processing options
 * @returns Processed buffer and trusted output MIME type
 * @throws {Error} If the image cannot be decoded or violates policy limits
 */
export function processImage(
  buffer: Buffer,
  mimeType: string,
  options: ImageProcessingOptions = {}
): Promise<{ buffer: Buffer; mimeType: string }> {
  return withImageProcessingSlot(() => processImageAttempt(buffer, mimeType, options, 0));
}

async function processImageAttempt(
  buffer: Buffer,
  mimeType: string,
  options: ImageProcessingOptions,
  retryCount: number
): Promise<{ buffer: Buffer; mimeType: string }> {
  const opts = { ...DEFAULT_IMAGE_OPTIONS, ...options };

  try {
    let pipeline = sharp(buffer, {
      limitInputPixels: Math.round(MAX_INPUT_PIXELS),
    });

    // Get image metadata to determine the actual input format
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // Validate decoded metadata against policy
    validateImageProcessing({
      width,
      height,
      format: metadata.format ?? "unknown",
    });

    // Determine trusted MIME from decoded content, not client headers
    const detectedFormat = metadata.format ?? "";
    const trustedMime = sanitizeMimeType(mimeType, formatToMimeType(detectedFormat));

    // Narrow to the normalized width; a long screenshot keeps its length so it stays legible.
    const target = fitNormalizedImage(width, height);
    if (target.width < width || target.height < height) {
      pipeline = pipeline.resize(target.width, target.height, { fit: "fill" });
    }

    // Determine output format
    let outputFormat = opts.format;
    if (outputFormat === "auto") {
      // Use the trusted MIME to decide output format
      outputFormat = trustedMime === "image/png" ? "png" : "webp";
    }

    // Apply format-specific compression
    let outputBuffer: Buffer;
    let outputMimeType: string;

    switch (outputFormat) {
      case "jpeg":
        outputBuffer = await pipeline
          .jpeg({
            quality: opts.quality,
            progressive: true,
            mozjpeg: true,
          })
          .toBuffer();
        outputMimeType = "image/jpeg";
        break;

      case "png":
        outputBuffer = await pipeline
          .png({
            compressionLevel: 9,
            progressive: true,
          })
          .toBuffer();
        outputMimeType = "image/png";
        break;

      case "webp":
        outputBuffer = await pipeline
          .webp({
            quality: opts.quality,
            effort: 6,
          })
          .toBuffer();
        outputMimeType = "image/webp";
        break;

      case "avif":
        outputBuffer = await pipeline
          .avif({
            quality: opts.quality,
            effort: 4,
          })
          .toBuffer();
        outputMimeType = "image/avif";
        break;

      default:
        // Keep original format with compression
        if (trustedMime === "image/jpeg") {
          outputBuffer = await pipeline
            .jpeg({
              quality: opts.quality,
              progressive: true,
              mozjpeg: true,
            })
            .toBuffer();
          outputMimeType = "image/jpeg";
        } else if (trustedMime === "image/png") {
          outputBuffer = await pipeline
            .png({
              compressionLevel: 9,
              progressive: true,
            })
            .toBuffer();
          outputMimeType = "image/png";
        } else if (trustedMime === "image/webp") {
          outputBuffer = await pipeline
            .webp({
              quality: opts.quality,
              effort: 6,
            })
            .toBuffer();
          outputMimeType = "image/webp";
        } else {
          // Default to JPEG for unknown formats
          outputBuffer = await pipeline
            .jpeg({
              quality: opts.quality,
              progressive: true,
            })
            .toBuffer();
          outputMimeType = "image/jpeg";
        }
    }

    // Final size check — use the processed output regardless of size comparison
    // (the original bytes have been decoded by sharp and are trusted, but we
    // always store the processed version for consistency)
    if (outputBuffer.length > MAX_OUTPUT_SIZE) {
      if (retryCount >= MAX_RETRIES || outputMimeType === "image/png" || opts.quality <= 60) {
        throw new ValidationError(
          "Unable to compress image within size limit using the permitted encoding settings"
        );
      }
      logger.warn(
        { size: outputBuffer.length, maxSize: MAX_OUTPUT_SIZE, retryCount: retryCount + 1 },
        "Processed image exceeds max size, retrying with lower quality"
      );
      // Attempt another pass with lower quality
      return processImageAttempt(
        buffer,
        mimeType,
        {
          ...opts,
          quality: Math.max(60, opts.quality - 15),
        },
        retryCount + 1
      );
    }

    logger.debug(
      {
        originalSize: buffer.length,
        processedSize: outputBuffer.length,
        originalMime: mimeType,
        outputMime: outputMimeType,
        trustedMime,
        width,
        height,
      },
      "Image processed successfully"
    );

    return { buffer: outputBuffer, mimeType: outputMimeType };
  } catch (error) {
    // Sharp decode/processing failure is terminal — do not return unverified original bytes
    logger.error({ error, mimeType }, "Image processing failed");
    throw error;
  }
}

/** A stored image as handed to the AI: whole, or cut into overlapping parts, top to bottom. */
export interface PreparedAiImage {
  contentType: string;
  parts: Buffer[];
  /** How many pixel rows neighbouring parts share; 0 for an image sent whole. */
  overlapPx: number;
}

/** Models shrink an image to fit a square-ish box; past 1:2 a tall screenshot's text gets too small. */
const MAX_PART_ASPECT = 2;
/** The share of a part repeated in the next one, so a row cut at the edge is whole in one of them. */
const PART_OVERLAP_RATIO = 0.1;
/** However long the screenshot, it is cut into no more parts than this. */
const MAX_PARTS = 8;

/**
 * Where to cut an image of the given size into parts no taller than twice its width that overlap
 * by at least a tenth of a part, spread evenly from top to bottom. Null when it is short enough to
 * be sent whole. A very long, narrow image gets taller parts rather than more than `MAX_PARTS`.
 */
export function planImageParts(
  width: number,
  height: number
): { tops: number[]; partHeight: number; overlapPx: number } | null {
  if (height <= width * MAX_PART_ASPECT) return null;
  let partHeight = width * MAX_PART_ASPECT;
  let overlap = Math.ceil(partHeight * PART_OVERLAP_RATIO);
  let count = Math.ceil((height - overlap) / (partHeight - overlap));
  if (count > MAX_PARTS) {
    count = MAX_PARTS;
    // The parts grow until eight of them, overlapping by a tenth, cover the whole height.
    partHeight = Math.ceil(height / (count - (count - 1) * PART_OVERLAP_RATIO));
    overlap = Math.ceil(partHeight * PART_OVERLAP_RATIO);
  }
  const step = (height - partHeight) / (count - 1);
  const tops = Array.from({ length: count }, (_, index) => Math.round(index * step));
  return { tops, partHeight, overlapPx: partHeight - Math.ceil(step) };
}

function partFormat(contentType: string): { format: "png" | "webp" | "jpeg"; mime: string } {
  if (contentType === "image/png") return { format: "png", mime: "image/png" };
  if (contentType === "image/webp") return { format: "webp", mime: "image/webp" };
  return { format: "jpeg", mime: "image/jpeg" };
}

/**
 * Checks that stored bytes are the image they claim to be and readies them for the AI, decoding
 * them once inside an image processing slot. An image too tall to read whole is cut into
 * overlapping parts (see `planImageParts`); any other is passed on as stored.
 */
export function prepareStoredImageForAI(
  buffer: Buffer,
  declaredContentType: string
): Promise<PreparedAiImage> {
  return withImageProcessingSlot(async () => {
    try {
      const image = sharp(buffer, { limitInputPixels: Math.round(MAX_INPUT_PIXELS) });
      const metadata = await image.metadata();
      validateImageProcessing({
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? "unknown",
      });
      const contentType = declaredContentType.toLowerCase();
      if (formatToMimeType(metadata.format ?? "unknown") !== contentType) {
        throw new ValidationError("Stored image content does not match its declared MIME type");
      }
      // The full decode proves the bytes are a whole image, not just a readable header.
      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      const plan = planImageParts(info.width, info.height);
      if (plan == null) return { contentType, parts: [buffer], overlapPx: 0 };
      const output = partFormat(contentType);
      const raw = { width: info.width, height: info.height, channels: info.channels };
      const parts: Buffer[] = [];
      for (const top of plan.tops) {
        parts.push(
          await sharp(data, { raw })
            .extract({ left: 0, top, width: info.width, height: plan.partHeight })
            .toFormat(output.format, output.format === "png" ? {} : { quality: 90 })
            .toBuffer()
        );
      }
      return { contentType: output.mime, parts, overlapPx: plan.overlapPx };
    } catch (error) {
      logger.error({ error, declaredContentType }, "Stored image content validation failed");
      throw error;
    }
  });
}

/**
 * Map a sharp format string to a MIME type.
 */
function formatToMimeType(format: string): string {
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    svg: "image/svg+xml",
    tiff: "image/tiff",
  };
  return map[format.toLowerCase()] ?? `image/${format.toLowerCase()}`;
}

/**
 * Check if a MIME type is a supported image format (Web upload policy).
 */
export function isSupportedImageFormat(mimeType: string): boolean {
  return SUPPORTED_MIME_SET.has(mimeType.toLowerCase());
}

/**
 * Get image dimensions without loading the full image
 */
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width != null && metadata.height != null) {
      return { width: metadata.width, height: metadata.height };
    }
    return null;
  } catch (error) {
    logger.error({ error }, "Failed to get image dimensions");
    return null;
  }
}
