import { ValidationError } from "@/lib/errors";
import { fitImageDimensions } from "@/lib/image-dimensions";

/**
 * Shared Web Upload Policy
 *
 * Central, provider-neutral policy constants and validators for Web source-document
 * uploads. Every upload layer — client preflight, server validation, and Sharp
 * processing — applies the same rules from this module.
 *
 * These defaults apply to the Web submission flow only. The API v1 flow
 * has its own separate limits and is not covered by this module.
 *
 * A stored file is checked against this policy when it is uploaded, not again when a later
 * submission reuses its id; a policy tightened in between does not reach files already stored.
 * The per-attempt byte budget is still enforced when the attempt is created.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of files per extraction attempt. */
export const MAX_FILES = 4;

/** Maximum original (raw uploaded) bytes per individual file. */
export const MAX_ORIGINAL_BYTES_PER_FILE = 20 * 1024 * 1024; // 20 MiB

/** Maximum normalized (post-processing) bytes per individual file. */
export const MAX_NORMALIZED_BYTES_PER_FILE = 4 * 1024 * 1024; // 4 MB

/**
 * Maximum total normalized bytes across all files in a single attempt. It bounds what one parse
 * sends the AI; a long screenshot kept legible takes one to two megabytes on its own.
 */
export const MAX_NORMALIZED_BYTES_PER_ATTEMPT = 6 * 1024 * 1024; // 6 MiB

/**
 * The size a stored image is normalized to, in the browser and again on the server. Receipts and
 * screenshots are read by their width, so the width is what is capped; a long screenshot keeps its
 * height up to WebP's limit, and the area stays under the canvas limit of iOS Safari (16,777,216
 * pixels), past which the browser cannot draw it at all.
 */
export const NORMALIZED_IMAGE_MAX_WIDTH = 1440;
export const NORMALIZED_IMAGE_MAX_HEIGHT = 16_383;
export const NORMALIZED_IMAGE_MAX_PIXELS = 16_000_000;

/** The size an image of the given dimensions is normalized to; never larger than it was. */
export function fitNormalizedImage(
  width: number,
  height: number
): { width: number; height: number } {
  return fitImageDimensions(
    width,
    height,
    NORMALIZED_IMAGE_MAX_WIDTH,
    NORMALIZED_IMAGE_MAX_HEIGHT,
    NORMALIZED_IMAGE_MAX_PIXELS
  );
}

/** Maximum megapixels per image file (width * height / 1_000_000). */
export const MAX_MEGAPIXELS_PER_FILE = 48;

/** Maximum characters in a text-only source-document submission. */
export const MAX_TEXT_CHARACTERS = 20000;

/**
 * Explicitly supported MIME types for Web uploads.
 *
 * HEIC/HEIF are omitted because sharp cannot decode them deterministically
 * across all inputs — encoding variants and exif orientation frequently cause
 * decode failures or silent data corruption. Users must convert to JPEG/PNG
 * before upload.
 */
export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/** Set form of SUPPORTED_MIME_TYPES for fast lookups. */
export const SUPPORTED_MIME_SET: ReadonlySet<string> = new Set(SUPPORTED_MIME_TYPES);

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate a file upload request against basic policy limits.
 * Throws an Error with a descriptive message if the request violates any constraint.
 */
export function validateFileUpload(file: { contentType: string; byteSize: number }): void {
  if (!SUPPORTED_MIME_SET.has(file.contentType)) {
    throw new ValidationError(`Unsupported content type: ${file.contentType}`);
  }
  if (!Number.isInteger(file.byteSize) || file.byteSize <= 0) {
    throw new ValidationError(`Invalid byte size: ${file.byteSize}`);
  }
  if (file.byteSize > MAX_ORIGINAL_BYTES_PER_FILE) {
    throw new ValidationError(
      `File exceeds maximum original size of ${MAX_ORIGINAL_BYTES_PER_FILE} bytes`
    );
  }
}

/**
 * Validate image processing metadata (pixel dimensions and format).
 * Throws if the image exceeds the megapixel limit or uses an unsupported format.
 */
export function validateImageProcessing(metadata: {
  width: number;
  height: number;
  format: string;
}): void {
  const megapixels = (metadata.width * metadata.height) / 1_000_000;
  if (megapixels > MAX_MEGAPIXELS_PER_FILE) {
    throw new ValidationError(
      `Image dimensions ${metadata.width}x${metadata.height} (${megapixels.toFixed(1)} MP) ` +
        `exceed maximum of ${MAX_MEGAPIXELS_PER_FILE} MP`
    );
  }
  const mimeType = formatToMimeType(metadata.format);
  if (!SUPPORTED_MIME_SET.has(mimeType)) {
    throw new ValidationError(`Unsupported image format: ${metadata.format}`);
  }
}

/**
 * Validate total normalized bytes against the per-attempt aggregate limit.
 * Called during attempt processing.
 *
 * @param aggregateNormalizedBytes - Sum of all previously stored normalized bytes
 *                                   across all files in the attempt.
 * @param newFileBytes - Normalized size of the file being added.
 */
export function validateAttemptUpload(
  aggregateNormalizedBytes: number,
  newFileBytes: number
): void {
  const total = aggregateNormalizedBytes + newFileBytes;
  if (total > MAX_NORMALIZED_BYTES_PER_ATTEMPT) {
    throw new ValidationError(
      `Total normalized bytes ${total} exceeds attempt limit of ` +
        `${MAX_NORMALIZED_BYTES_PER_ATTEMPT}`
    );
  }
}

/**
 * Check whether a file count is within policy bounds.
 */
export function validateFileCount(count: number): void {
  if (count < 1 || count > MAX_FILES) {
    throw new ValidationError(`File count ${count} must be between 1 and ${MAX_FILES}`);
  }
}

/**
 * Validate that the combined total of stored-file IDs, inline images,
 * and original images does not exceed the per-attempt file limit.
 *
 * Called at schema, server-function, and transaction layers for defense in depth.
 */
export function validateAggregateFileCount(
  storedFileIdsCount: number,
  imageCount: number,
  originalImageCount: number = 0
): void {
  const total = storedFileIdsCount + imageCount + originalImageCount;
  if (total > MAX_FILES) {
    throw new ValidationError(`Total file count ${total} exceeds maximum of ${MAX_FILES} files`);
  }
}

/**
 * Sanitize and resolve the trusted MIME type.
 *
 * Trusts the detected type (from content inspection, e.g. sharp metadata) over
 * the declared type (from client headers). Throws if neither value is supported.
 *
 * @param declared - MIME type declared by the client (headers / form field).
 * @param detected - MIME type detected from actual content inspection, or null
 *                   if no detection was possible.
 * @returns The canonical supported MIME type.
 */
export function sanitizeMimeType(declared: string, detected: string | null): string {
  const detectedClean = detected?.toLowerCase() ?? "";
  const declaredClean = declared.toLowerCase();

  if (detectedClean !== "" && SUPPORTED_MIME_SET.has(detectedClean)) {
    return detectedClean;
  }

  if (SUPPORTED_MIME_SET.has(declaredClean)) {
    return declaredClean;
  }

  throw new ValidationError(
    `Unsupported MIME type: declared="${declaredClean}", detected="${detectedClean}"`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a format identifier (e.g. "jpeg", "png") to its MIME type string.
 */
function formatToMimeType(format: string): string {
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
  };
  return map[format.toLowerCase()] ?? `image/${format.toLowerCase()}`;
}
