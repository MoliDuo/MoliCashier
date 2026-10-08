/**
 * API v1 upload policy
 *
 * Shared limits, inline-image decoding, and the internal prepared-input
 * contract for the stable v1 public API. The route, contract schemas,
 * credential submission, and client preflight all read the same constants
 * from this module so the source-document domain never depends on src/app.
 */

import { ValidationError } from "@/lib/errors";

/** Maximum number of inline images per API v1 request. */
export const API_V1_MAX_IMAGES = 3;

/** Maximum decoded bytes for a single inline image: a phone photo straight from the camera. */
export const API_V1_MAX_DECODED_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MiB

/**
 * Maximum total decoded bytes across all images in one API v1 request. What is stored is the
 * normalized form, which a submission still limits to 6 MiB in total.
 */
export const API_V1_MAX_DECODED_BATCH_BYTES = 24 * 1024 * 1024; // 24 MiB

/**
 * Maximum raw JSON request body size.
 *
 * 24 MiB of decoded data needs exactly 32 MiB of base64 characters; the 64 KiB
 * allowance covers the three possible data: URL prefixes, the MIME strings,
 * and the JSON structure around the images, so any payload that passes the
 * decoded-size checks can never be rejected on the wire.
 */
export const API_V1_MAX_REQUEST_BYTES =
  Math.ceil((API_V1_MAX_DECODED_BATCH_BYTES * 4) / 3) + 64 * 1024;

/**
 * An inline image that has been validated once at the API boundary.
 *
 * Only decoded bytes, the canonical MIME type, and the content hash travel
 * through the rest of the pipeline; the original base64 representation is
 * never retained alongside the bytes.
 */
export interface PreparedInlineImage {
  bytes: Buffer;
  mimeType: string;
  contentHash: string;
}

/** Prepared API v1 request payload, produced by createSourceDocumentInputSchemaV1. */
export interface PreparedApiV1SourceDocumentInput {
  images: PreparedInlineImage[];
  entryDate?: string;
}

const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface DecodedBase64Image {
  bytes: Buffer;
  normalizedBase64: string;
}

export function decodeBase64Image(data: string, declaredMimeType: string): DecodedBase64Image {
  let encoded = data;
  if (data.startsWith("data:")) {
    const match = DATA_URL_PATTERN.exec(data);
    if (match == null) throw new ValidationError("Invalid image data URL");
    if (match[1]!.toLowerCase() !== declaredMimeType.toLowerCase()) {
      throw new ValidationError("MIME type does not match the image data URL");
    }
    encoded = match[2]!;
  }

  const unpadded = encoded.replace(/[\t\n\f\r ]+/g, "");
  if (unpadded.length === 0) throw new ValidationError("Image data is empty");
  if (!BASE64_PATTERN.test(unpadded) || unpadded.length % 4 === 1) {
    throw new ValidationError("Invalid base64 image data");
  }
  const firstPadding = unpadded.indexOf("=");
  if (firstPadding >= 0 && unpadded.length % 4 !== 0) {
    throw new ValidationError("Invalid base64 image data");
  }
  const normalizedBase64 =
    firstPadding >= 0
      ? unpadded
      : unpadded.padEnd(unpadded.length + ((4 - (unpadded.length % 4)) % 4), "=");

  const bytes = Buffer.from(normalizedBase64, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== normalizedBase64) {
    throw new ValidationError("Invalid base64 image data");
  }
  return { bytes, normalizedBase64 };
}
