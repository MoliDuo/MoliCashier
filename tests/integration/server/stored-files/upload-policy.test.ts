import type { ObjectStore } from "@/lib/storage";
/**
 * Upload Policy Integration Tests
 *
 * Covers boundary enforcement across the full upload -> attempt-attach
 * pipeline, using the real Postgres adapters with an in-memory R2 store.
 * Every test verifies that policy violations terminate before durable state
 * is created and that internal keys are never leaked.
 */

import sharp from "sharp";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { storeProcessedImages, storeUploadedImage } from "@/server/stored-files/uploads";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { createProcessingAttemptInTransaction } from "@/modules/source-document/server/extraction-attempts";
import { ValidationError } from "@/lib/errors";
import { MAX_NORMALIZED_BYTES_PER_ATTEMPT, MAX_FILES } from "@/lib/storage/upload-policy";
import { extractionAttempts, storedFiles } from "@/persistence";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

/** A ready stored file holding `body`, as the server stores an image it already holds. */
async function finalizedFile(body: Buffer): Promise<{ id: string }> {
  const [id] = await storeProcessedImages([{ bytes: body, contentType: "image/jpeg" }]);
  return { id: id! };
}

describe("upload policy integration", () => {
  describe("aggregate byte overflow at attempt attachment", () => {
    it("rejects attempt attachment when total bytes exceed MAX_NORMALIZED_BYTES_PER_ATTEMPT", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      // Create enough finalized stored files to overflow the attempt aggregate limit.
      // Each file fits the attempt limit on its own, but their sum does not.
      const fileSize = Math.floor(MAX_NORMALIZED_BYTES_PER_ATTEMPT * 0.6);
      const fileCount = 2;
      const totalBytes = fileSize * fileCount;
      expect(totalBytes).toBeGreaterThan(MAX_NORMALIZED_BYTES_PER_ATTEMPT);

      const files = await Promise.all(
        Array.from({ length: fileCount }, () => finalizedFile(Buffer.alloc(fileSize, 0xff)))
      );

      // Try to create a pending attempt linking both files — must run inside a
      // db.transaction since createProcessingAttemptInTransaction expects a tx handle.
      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No attempt rows were created in the database
      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });

    it("accepts attempt attachment when total bytes are within limit", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("small-file");
      const file = await finalizedFile(body);

      const result = await db.transaction(async (tx) =>
        createProcessingAttemptInTransaction(tx, {
          bookId,
          input: { text: null, storedFileIds: [file.id], documentDate: "2026-07-15" },
        })
      );

      expect(result.attempt).toMatchObject({
        sourceDocumentId: result.document.id,
        processingStatus: "processing",
      });
      expect(result.document.latestAttemptId).toBe(result.attempt.id);
    });
  });

  describe("aggregate file count at attempt boundary", () => {
    it("rejects attempt attachment when file count exceeds MAX_FILES", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      // Create MAX_FILES + 1 finalized stored files
      const body = Buffer.from("tiny");
      const files = await Promise.all(
        Array.from({ length: MAX_FILES + 1 }, () => finalizedFile(body))
      );

      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No attempt was created
      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });

    it("accepts attempt attachment at exactly MAX_FILES", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("tiny");
      const files = await Promise.all(Array.from({ length: MAX_FILES }, () => finalizedFile(body)));

      const result = await db.transaction(async (tx) =>
        createProcessingAttemptInTransaction(tx, {
          bookId,
          input: {
            text: null,
            storedFileIds: files.map((f) => f.id),
            documentDate: "2026-07-15",
          },
        })
      );

      expect(result.attempt).toMatchObject({
        sourceDocumentId: result.document.id,
        processingStatus: "processing",
      });
      expect(result.document.latestAttemptId).toBe(result.attempt.id);
    });

    it("rejects attempt with duplicate stored-file IDs", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const file = await finalizedFile(Buffer.from("tiny"));

      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: [file.id, file.id],
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });
  });

  describe("R2 storage keys are never exposed in responses", () => {
    it("does not return storageKey in stored file query results", async () => {
      const db = getTestDb();
      await createTestLedger(db);
      objectStore.current = new MemoryObjectStore();

      const storage = new MemoryObjectStore();
      objectStore.current = storage;
      const body = await sharp({
        create: { width: 1, height: 1, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const file = await storeUploadedImage({
        bytes: body,
        contentType: "image/jpeg",
        originalFilename: null,
      });

      // The StoredFileContract returned by the adapter should not contain storageKey
      expect(file).not.toHaveProperty("storageKey");
      expect(file).not.toHaveProperty("storageProvider");

      // The metadata on the contract should not contain storageKey
      if (file.metadata && typeof file.metadata === "object") {
        expect(file.metadata).not.toHaveProperty("storageKey");
      }

      // Verify the raw database row does have storageKey (it exists in the DB)
      const rawRow = await db
        .select({
          storageKey: storedFiles.storageKey,
        })
        .from(storedFiles)
        .where(eq(storedFiles.id, file.id))
        .then((rows) => rows[0]);
      expect(rawRow).toEqual({ storageKey: `stored/${file.id}` });
    });
  });
});
