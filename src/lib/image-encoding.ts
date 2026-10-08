/** The box an image is shrunk into, and the most pixels it may hold. */
export interface ImageSizeLimits {
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
}

/** Each step down in JPEG quality while an image is over its byte budget, and the floor. */
const QUALITY_STEP = 0.15;
const MIN_QUALITY = 0.5;

/**
 * Encodes at `quality`, then at lower qualities while the result is over `maxBytes`, down to a
 * floor; the last try is returned even when still over, for the server to refuse with a reason.
 */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Blob>,
  quality: number,
  maxBytes: number
): Promise<Blob> {
  let current = quality;
  let blob = await encode(current);
  while (blob.size > maxBytes && current > MIN_QUALITY) {
    current = Math.max(MIN_QUALITY, current - QUALITY_STEP);
    blob = await encode(current);
  }
  return blob;
}
