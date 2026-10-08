/**
 * The largest size, keeping the aspect ratio and never enlarging, that fits `maxWidth` by
 * `maxHeight` and, when given, holds no more than `maxPixels` pixels.
 */
export function fitImageDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
  maxPixels = Number.POSITIVE_INFINITY
): { width: number; height: number } {
  const scale = Math.min(
    1,
    maxWidth / width,
    maxHeight / height,
    Math.sqrt(maxPixels / (width * height))
  );
  return {
    width: Math.max(1, Math.floor(width * scale + 1e-9)),
    height: Math.max(1, Math.floor(height * scale + 1e-9)),
  };
}
