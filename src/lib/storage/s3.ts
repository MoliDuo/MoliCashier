import "server-only";
import crypto from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { AppError } from "@/lib/errors";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import {
  assertSafeStorageKey,
  type ListedObject,
  type ListObjectsPage,
  type ObjectStore,
} from "./index";

type ObjectClient = Pick<S3Client, "send">;

function isNotFound(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}

function httpStatusOf(error: unknown): number | undefined {
  if (error == null || typeof error !== "object") return undefined;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

function storageError(message: string, code: string, key: string, cause?: unknown): AppError {
  const keyHash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
  const httpStatusCode = httpStatusOf(cause);
  logger.error(
    {
      provider: "s3",
      keyHash,
      errorName: cause instanceof Error ? cause.name : "UnknownError",
      ...(httpStatusCode == null ? {} : { httpStatusCode }),
    },
    message
  );
  // The status tells an outage (5xx, none at all) from a refusal (4xx) when the failure is classified.
  return new AppError(message, code, code === "FILE_NOT_FOUND" ? 404 : 503, {
    provider: "s3",
    keyHash,
    ...(httpStatusCode == null ? {} : { httpStatusCode }),
  });
}

/** How long connecting to the object store, and then one whole request, may take. */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 30_000;

export function createS3ClientConfig(): S3ClientConfig {
  return {
    region: runtimeEnv.s3Region,
    endpoint: runtimeEnv.s3Endpoint,
    forcePathStyle: runtimeEnv.s3ForcePathStyle,
    credentials: {
      accessKeyId: runtimeEnv.s3AccessKeyId,
      secretAccessKey: runtimeEnv.s3SecretAccessKey,
    },
    // Without these an object store that accepts the connection and never answers holds the
    // request, and whatever waits on it, forever.
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: S3_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  };
}

export class S3StorageProvider implements ObjectStore {
  private client: ObjectClient | null;

  constructor(
    client?: ObjectClient,
    private readonly configuredBucket?: string
  ) {
    this.client = client ?? null;
  }

  private getClient(): ObjectClient {
    this.client ??= new S3Client(createS3ClientConfig());
    return this.client;
  }

  private getBucket(): string {
    return this.configuredBucket ?? runtimeEnv.s3Bucket;
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeStorageKey(key);
    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: this.getBucket(),
          Key: key,
          Body: data,
          ContentType: contentType,
        })
      );
    } catch (error) {
      throw storageError("Failed to upload file to S3", "S3_UPLOAD_FAILED", key, error);
    }
  }

  /** Reads a whole object. `signal` abandons the request, its body included. */
  async download(key: string, options: { signal?: AbortSignal } = {}): Promise<Buffer> {
    assertSafeStorageKey(key);
    try {
      const response = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.getBucket(), Key: key }),
        options.signal == null ? {} : { abortSignal: options.signal }
      );
      if (response.Body == null) throw storageError("File not found in S3", "FILE_NOT_FOUND", key);
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isNotFound(error)) {
        throw storageError("File not found in S3", "FILE_NOT_FOUND", key, error);
      }
      throw storageError("Failed to download file from S3", "S3_DOWNLOAD_FAILED", key, error);
    }
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array>> {
    assertSafeStorageKey(key);
    try {
      const response = await this.getClient().send(
        new GetObjectCommand({ Bucket: this.getBucket(), Key: key })
      );
      if (response.Body == null) throw storageError("File not found in S3", "FILE_NOT_FOUND", key);
      return response.Body.transformToWebStream();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isNotFound(error)) {
        throw storageError("File not found in S3", "FILE_NOT_FOUND", key, error);
      }
      throw storageError("Failed to stream file from S3", "S3_DOWNLOAD_FAILED", key, error);
    }
  }

  async delete(key: string): Promise<{ success: boolean; key: string; error?: Error }> {
    assertSafeStorageKey(key);
    try {
      await this.getClient().send(new DeleteObjectCommand({ Bucket: this.getBucket(), Key: key }));
      return { success: true, key };
    } catch (error) {
      const mapped = storageError("Failed to delete file from S3", "S3_DELETE_FAILED", key, error);
      return { success: false, key, error: mapped };
    }
  }

  /**
   * List a page of objects under a prefix using S3 pagination.
   *
   * The bucket is never fully loaded into memory: callers iterate pages via
   * `nextContinuationToken` and process each page in batches.
   */
  async listObjectsPage(
    prefix: string,
    continuationToken?: string | null,
    maxKeys = 1000
  ): Promise<ListObjectsPage> {
    try {
      const response = await this.getClient().send(
        new ListObjectsV2Command({
          Bucket: this.getBucket(),
          Prefix: prefix,
          MaxKeys: maxKeys,
          ...(continuationToken == null || continuationToken === ""
            ? {}
            : { ContinuationToken: continuationToken }),
        })
      );
      const objects: ListedObject[] = (response.Contents ?? []).flatMap((object) => {
        if (object.Key == null || object.Key === "") return [];
        return [
          {
            key: object.Key,
            byteSize: object.Size ?? 0,
            lastModified: object.LastModified ?? null,
          },
        ];
      });
      return {
        objects,
        isTruncated: response.IsTruncated === true,
        nextContinuationToken: response.NextContinuationToken ?? null,
      };
    } catch (error) {
      throw storageError("Failed to list S3 objects", "S3_LIST_FAILED", prefix, error);
    }
  }
}

let instance: S3StorageProvider | null = null;

export function getS3Storage(): S3StorageProvider {
  instance ??= new S3StorageProvider();
  return instance;
}
