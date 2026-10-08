import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { EvidenceImage } from "@/lib/ai/evidence-images";
import { prepareStoredImageForAI } from "@/lib/storage/image-processing";
import { readAuthorizedFile } from "@/server/stored-files/reads";

function dataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function loadStoredFileForAI(
  storedFileId: string,
  signal: AbortSignal | undefined
): Promise<EvidenceImage> {
  try {
    const read = await readAuthorizedFile(storedFileId, signal == null ? {} : { signal });
    if (read == null) throw new ValidationError("Stored image is not available for this attempt");
    const prepared = await prepareStoredImageForAI(
      Buffer.from(read.body),
      read.file.metadata.contentType
    );
    if (prepared.parts.length === 1) {
      return { dataUrl: dataUrl(prepared.contentType, prepared.parts[0]!) };
    }
    return {
      parts: prepared.parts.map((part) => dataUrl(prepared.contentType, part)),
      overlapPx: prepared.overlapPx,
    };
  } catch (error) {
    logger.error(
      { error, storedFileSubject: logIdentifier("stored-file", storedFileId) },
      "Failed to load stored image evidence for AI"
    );
    // The cause is kept so that an object store outage is told apart from a broken file.
    throw Object.assign(new AppError("Failed to load stored image evidence", "IMAGE_LOAD_FAILED"), {
      cause: error,
    });
  }
}

/**
 * Result of loading an image for AI processing.
 * `success` is the discriminant so downstream filters can narrow correctly.
 */
export interface SuccessfulLoadImageResult {
  url: string;
  image: EvidenceImage;
  success: true;
}

export interface FailedLoadImageResult {
  url: string;
  error: Error;
  success: false;
}

export type LoadImageResult = SuccessfulLoadImageResult | FailedLoadImageResult;

export function isSuccessfulLoadImageResult(
  result: LoadImageResult
): result is SuccessfulLoadImageResult {
  return result.success;
}

export function isFailedLoadImageResult(result: LoadImageResult): result is FailedLoadImageResult {
  return !result.success;
}

/**
 * Downloads, checks and readies a document's images for the AI. `signal` abandons the downloads,
 * so a parse that runs out of time is not held up by a slow object store.
 */
export async function loadStoredFilesForAI(
  storedFileIds: string[],
  options: { signal?: AbortSignal } = {}
): Promise<LoadImageResult[]> {
  return Promise.all(
    storedFileIds.map(async (storedFileId) => {
      try {
        return {
          url: storedFileId,
          image: await loadStoredFileForAI(storedFileId, options.signal),
          success: true as const,
        };
      } catch (error) {
        return {
          url: storedFileId,
          error: error instanceof Error ? error : new Error(String(error)),
          success: false as const,
        };
      }
    })
  );
}
