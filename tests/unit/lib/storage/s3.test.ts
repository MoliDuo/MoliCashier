import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { createS3ClientConfig, S3StorageProvider } from "@/lib/storage/s3";

function provider(send: ReturnType<typeof vi.fn>): S3StorageProvider {
  return new S3StorageProvider({ send } as unknown as Pick<S3Client, "send">, "cashier-images");
}

describe("S3StorageProvider", () => {
  it("returns the SDK stream without buffering the object", async () => {
    const body = new ReadableStream<Uint8Array>();
    const transformToByteArray = vi.fn();
    const send = vi.fn().mockResolvedValue({
      Body: { transformToWebStream: () => body, transformToByteArray },
    });

    await expect(provider(send).stream("stored/file")).resolves.toBe(body);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(transformToByteArray).not.toHaveBeenCalled();
  });

  it("puts, gets, and idempotently deletes private objects", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn(async () => new Uint8Array([1, 2, 3])) },
      })
      .mockResolvedValueOnce({});
    const storage = provider(send);

    await expect(
      storage.upload("stored/file", Buffer.from([1, 2, 3]), "image/png")
    ).resolves.toBeUndefined();
    await expect(storage.download("stored/file")).resolves.toEqual(Buffer.from([1, 2, 3]));
    await expect(storage.delete("stored/file")).resolves.toMatchObject({ success: true });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("maps missing objects and SDK failures to controlled errors", async () => {
    const missing = Object.assign(new Error("not found"), {
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(
      provider(vi.fn().mockRejectedValue(missing)).download("stored/file")
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND", statusCode: 404 });

    await expect(
      provider(vi.fn().mockRejectedValue(new Error("network"))).upload(
        "stored/file",
        Buffer.from("x"),
        "image/jpeg"
      )
    ).rejects.toMatchObject({ code: "S3_UPLOAD_FAILED", statusCode: 503 });
  });

  it("downloads an object's bytes", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: vi.fn(async () => new Uint8Array([1, 2, 3])) },
    });

    await expect(provider(send).download("stored/file")).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("hands the caller's abort signal to the SDK", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: vi.fn(async () => new Uint8Array([1])) },
    });
    const controller = new AbortController();

    await provider(send).download("stored/file", { signal: controller.signal });

    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal: controller.signal });
  });

  it("keeps the status of a failed download, so an outage tells apart from a refusal", async () => {
    const outage = Object.assign(new Error("unavailable"), { $metadata: { httpStatusCode: 503 } });
    await expect(
      provider(vi.fn().mockRejectedValue(outage)).download("stored/file")
    ).rejects.toMatchObject({ code: "S3_DOWNLOAD_FAILED", details: { httpStatusCode: 503 } });
  });

  it("gives up on an object store that does not connect or answer in time", () => {
    expect(createS3ClientConfig().requestHandler).toEqual({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      throwOnRequestTimeout: true,
    });
  });

  it("rejects unsafe object keys before calling S3", async () => {
    const send = vi.fn();
    const storage = provider(send);

    for (const key of ["/absolute", "../escape", "a\\b", "a//b", "a/./b"]) {
      await expect(storage.download(key)).rejects.toThrow("Invalid storage key");
    }
    expect(send).not.toHaveBeenCalled();
  });
});
