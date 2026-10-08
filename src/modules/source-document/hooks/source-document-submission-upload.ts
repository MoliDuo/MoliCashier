"use client";

import { compressImage, NORMALIZED_IMAGE_LIMITS } from "@/lib/image-utils";
import { MAX_FILES, MAX_ORIGINAL_BYTES_PER_FILE } from "@/lib/storage/upload-policy";

export interface SourceDocumentUploadImage {
  file: File;
  mimeType: string;
}

export interface SourceDocumentSubmitPayload {
  documentDate: string;
  text: string | null;
  images?: SourceDocumentUploadImage[];
  storedFileIds: string[];
}

export interface SourceDocumentSubmissionProgress {
  phase: "preparing" | "uploading" | "submitting" | "cancelling" | "complete";
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  fileIndex?: number;
  fileCount?: number;
}

export type SourceDocumentSubmissionUploadStage = "prepare" | "upload";

export class SourceDocumentSubmissionUploadError extends Error {
  constructor(
    message: string,
    public readonly stage: SourceDocumentSubmissionUploadStage,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SourceDocumentSubmissionUploadError";
  }
}

interface InlinePreparationDependencies {
  compress?: typeof compressImage;
  post?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * A photo above this size is shrunk in the browser first, to save the upload; the server normalizes
 * every image again, so this is only about bytes on the wire.
 */
const COMPRESS_ABOVE_BYTES = 2 * 1024 * 1024;
const COMPRESS_QUALITY = 0.85;
const UPLOAD_CONCURRENCY = 2;
const UPLOAD_ATTEMPTS = 3;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Upload aborted", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Rejections that retrying cannot fix: the server understood the request and refused it. */
function isFinalRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function submissionBase(payload: SourceDocumentSubmitPayload): SourceDocumentSubmitPayload {
  return {
    documentDate: payload.documentDate,
    text: payload.text,
    storedFileIds: payload.storedFileIds,
  };
}

async function prepareFile(file: File, deps: InlinePreparationDependencies): Promise<File> {
  throwIfAborted(deps.signal);
  if (file.size <= COMPRESS_ABOVE_BYTES) return file;
  try {
    const compressed = await (deps.compress ?? compressImage)(
      file,
      NORMALIZED_IMAGE_LIMITS,
      COMPRESS_QUALITY,
      deps.signal
    );
    throwIfAborted(deps.signal);
    return compressed.file.size < file.size ? compressed.file : file;
  } catch (error) {
    if (deps.signal?.aborted === true || isAbortError(error)) {
      throwIfAborted(deps.signal);
      throw error;
    }
    // The original is still uploadable when it fits the server's limit.
    if (file.size <= MAX_ORIGINAL_BYTES_PER_FILE) return file;
    throw new SourceDocumentSubmissionUploadError("Failed to compress source image", "prepare", {
      cause: error,
    });
  }
}

async function uploadFile(file: File, deps: InlinePreparationDependencies): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    throwIfAborted(deps.signal);
    try {
      const response = await (deps.post ?? fetch)("/api/stored-files", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) },
        body: file,
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      });
      if (response.ok) {
        const stored = (await response.json()) as { id?: unknown };
        if (typeof stored.id !== "string") throw new Error("Upload response had no file id");
        return stored.id;
      }
      lastError = new Error(`Upload failed with ${response.status}`);
      if (isFinalRefusal(response.status)) break;
    } catch (error) {
      if (deps.signal?.aborted === true || isAbortError(error)) {
        throwIfAborted(deps.signal);
        throw error;
      }
      lastError = error;
    }
  }
  throwIfAborted(deps.signal);
  throw lastError ?? new Error("Upload failed");
}

/**
 * Sends a submission's images to the server one request each and returns the payload naming the
 * stored files. Nothing is kept on the server that a document does not take: files that end up
 * unused are swept after a week.
 */
export async function uploadSourceDocumentSubmissionImages(
  payload: SourceDocumentSubmitPayload,
  dependencies: InlinePreparationDependencies = {},
  onProgress?: (progress: SourceDocumentSubmissionProgress) => void
): Promise<SourceDocumentSubmitPayload> {
  const images = payload.images ?? [];
  const base = submissionBase(payload);
  if (images.length === 0) return base;
  if (images.length + payload.storedFileIds.length > MAX_FILES) {
    throw new SourceDocumentSubmissionUploadError(`Maximum ${MAX_FILES} images allowed`, "prepare");
  }

  onProgress?.({ phase: "preparing", percent: 0, fileCount: images.length });
  const files = await Promise.all(images.map((image) => prepareFile(image.file, dependencies)));
  if (files.some((file) => file.size > MAX_ORIGINAL_BYTES_PER_FILE)) {
    throw new SourceDocumentSubmissionUploadError(
      "Images cannot be compressed within the upload size limit",
      "prepare"
    );
  }

  try {
    throwIfAborted(dependencies.signal);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    const storedFileIds: string[] = new Array<string>(files.length);
    let loadedBytes = 0;
    let nextIndex = 0;
    onProgress?.({
      phase: "uploading",
      percent: 20,
      loadedBytes,
      totalBytes,
      fileCount: files.length,
    });
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        const file = files[index]!;
        storedFileIds[index] = await uploadFile(file, dependencies);
        loadedBytes += file.size;
        onProgress?.({
          phase: "uploading",
          percent: 20 + Math.round((loadedBytes / totalBytes) * 75),
          loadedBytes,
          totalBytes,
          fileIndex: index,
          fileCount: files.length,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
    throwIfAborted(dependencies.signal);
    return { ...base, storedFileIds: [...base.storedFileIds, ...storedFileIds] };
  } catch (error) {
    if (dependencies.signal?.aborted === true || isAbortError(error)) {
      throwIfAborted(dependencies.signal);
      throw error;
    }
    throw new SourceDocumentSubmissionUploadError("Failed to upload source image", "upload", {
      cause: error,
    });
  }
}
