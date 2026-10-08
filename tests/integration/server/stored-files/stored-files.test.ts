import type { ObjectStore } from "@/lib/storage";
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger } from "tests/helpers/schema-setup";
import { storeProcessedImages, storeUploadedImage } from "@/server/stored-files/uploads";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import {
  MAX_NORMALIZED_BYTES_PER_FILE,
  MAX_ORIGINAL_BYTES_PER_FILE,
} from "@/lib/storage/upload-policy";
import { storedFiles } from "@/persistence";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

async function receiptJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
    .jpeg()
    .toBuffer();
}

/** A PNG that stays about as large as its pixels, so its size can be aimed at a limit. */
async function noisePng(side: number): Promise<Buffer> {
  const raw = Buffer.alloc(side * side * 3);
  for (let offset = 0; offset < raw.length; offset += 1) raw[offset] = Math.random() * 256;
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .png()
    .toBuffer();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function setup(): Promise<MemoryObjectStore> {
  await createTestLedger(getTestDb());
  const storage = new MemoryObjectStore();
  objectStore.current = storage;
  return storage;
}

describe("stored-file uploads and reads", () => {
  it("normalizes an uploaded image and stores it as a ready file", async () => {
    const storage = await setup();

    const file = await storeUploadedImage({
      bytes: await receiptJpeg(),
      contentType: "image/jpeg",
      originalFilename: "receipt.jpg",
    });

    const stored = storage.files.get(`stored/${file.id}`)!;
    expect(file.metadata).toMatchObject({
      byteSize: stored.length,
      originalFilename: "receipt.jpg",
      checksum: sha256(stored),
    });
    expect(
      await getTestDb().query.storedFiles.findFirst({ where: eq(storedFiles.id, file.id) })
    ).toMatchObject({ contentType: file.metadata.contentType });
    expect([...storage.files.keys()]).toEqual([`stored/${file.id}`]);
  });

  it("stores what Sharp found in the bytes rather than what the upload declared", async () => {
    await setup();

    const file = await storeUploadedImage({
      bytes: await receiptJpeg(),
      contentType: "image/png",
      originalFilename: null,
    });

    expect(file.metadata.contentType).toBe("image/webp");
  });

  it.each([
    ["an unsupported type", Buffer.from("x"), "image/bmp"],
    ["an empty body", Buffer.alloc(0), "image/jpeg"],
    ["bytes that are not an image", Buffer.from("not an image"), "image/jpeg"],
  ])("refuses %s before recording anything", async (_name, bytes, contentType) => {
    const storage = await setup();

    await expect(
      storeUploadedImage({ bytes, contentType, originalFilename: null })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });

  it("refuses a body over the per-file limit", async () => {
    await setup();

    await expect(
      storeUploadedImage({
        bytes: Buffer.alloc(MAX_ORIGINAL_BYTES_PER_FILE + 1),
        contentType: "image/jpeg",
        originalFilename: null,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses an image whose normalized form is over the per-file limit", async () => {
    const storage = await setup();
    // About 5 MB once encoded, and a PNG cannot be re-encoded smaller at a lower quality.
    const bytes = await noisePng(1300);
    expect(bytes.length).toBeGreaterThan(MAX_NORMALIZED_BYTES_PER_FILE);

    await expect(
      storeUploadedImage({ bytes, contentType: "image/png", originalFilename: null })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    expect(storage.files.size).toBe(0);
  });

  it("leaves nothing behind when the object cannot be written", async () => {
    const storage = await setup();
    storage.upload = async () => {
      throw new Error("storage unavailable");
    };

    await expect(
      storeUploadedImage({
        bytes: await receiptJpeg(),
        contentType: "image/jpeg",
        originalFilename: null,
      })
    ).rejects.toThrow("storage unavailable");

    expect(await getTestDb().select().from(storedFiles)).toEqual([]);
  });

  it("writes the row before the object, so an object never exists without one", async () => {
    const storage = await setup();
    const rowsWhenWritten: number[] = [];
    const upload = storage.upload.bind(storage);
    storage.upload = async (key, data) => {
      rowsWhenWritten.push((await getTestDb().select().from(storedFiles)).length);
      return upload(key, data);
    };

    await storeUploadedImage({
      bytes: await receiptJpeg(),
      contentType: "image/jpeg",
      originalFilename: null,
    });

    expect(rowsWhenWritten).toEqual([1]);
  });

  it("stores server-held images as ready files", async () => {
    const db = getTestDb();
    const storage = await setup();
    const bytes = Buffer.from("normalized-image");

    const [id] = await storeProcessedImages([{ bytes, contentType: "image/webp" }]);

    expect([...storage.files.keys()]).toEqual([`stored/${id}`]);
    expect(await db.query.storedFiles.findFirst({ where: eq(storedFiles.id, id!) })).toMatchObject({
      contentType: "image/webp",
      byteSize: bytes.length,
      checksum: sha256(bytes),
    });
  });

  it("leaves nothing behind when a server-held image cannot be stored", async () => {
    const db = getTestDb();
    const storage = await setup();
    storage.upload = async () => {
      throw new Error("storage unavailable");
    };

    await expect(
      storeProcessedImages([{ bytes: Buffer.from("image"), contentType: "image/webp" }])
    ).rejects.toThrow("storage unavailable");

    expect(await db.select().from(storedFiles)).toEqual([]);
  });
});
