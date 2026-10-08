/**
 * API v1 upload policy
 *
 * Shared limits and the internal prepared-input contract for the stable v1
 * public API. The route, contract schemas, credential submission, and client
 * preflight all read the same constants from this module so the
 * source-document domain never depends on src/app.
 */

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
