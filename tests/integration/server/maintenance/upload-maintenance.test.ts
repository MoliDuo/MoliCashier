import { describe, expect, it, vi } from "vitest";
import type { ObjectStore } from "@/lib/storage";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { eq } from "drizzle-orm";
import { sourceDocuments, storedFiles } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

import { runDailyMaintenance } from "@/server/maintenance/daily";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seed() {
  const db = getTestDb();
  await createTestLedger(db);
  const storage = new MemoryObjectStore();
  objectStore.current = storage;
  const now = Date.now();
  // An object outside `stored/` is never the sweep's to delete.
  const foreignPrefix = crypto.randomUUID();
  const file = (name: string, createdAt: number) => ({
    id: crypto.randomUUID(),
    storageKey: `stored/${name}`,
    contentType: "image/webp",
    byteSize: 1,
    createdAt: new Date(createdAt),
  });
  const oldReady = file("old-ready", now - 3 * DAY_MS);
  const unused = file("unused", now - 7 * DAY_MS - 60_000);
  const used = file("used", now - 30 * DAY_MS);
  const rows = [oldReady, unused, used];
  await db.insert(storedFiles).values(rows);
  const objectAt = async (key: string, modifiedAt: number) => {
    await storage.upload(key, Buffer.from(key));
    storage.modifiedAt.set(key, new Date(modifiedAt));
  };
  for (const row of rows) await objectAt(row.storageKey, row.createdAt.getTime());
  await submitSourceDocument({
    bookId: await testBookId(db),
    input: { text: null, storedFileIds: [used.id], documentDate: null },
  });
  await objectAt("stored/orphan", now - DAY_MS - 60_000);
  await objectAt(`${foreignPrefix}/stored/orphan`, now - DAY_MS - 60_000);
  await objectAt("stored/young-orphan", now - DAY_MS + 60_000);
  return {
    db,
    foreignPrefix,
    storage,
    objectAt,
    oldReady,
    used,
  };
}

describe("daily upload maintenance", () => {
  it("deletes unused files and old objects nothing names", async () => {
    const { db, foreignPrefix, storage, oldReady, used } = await seed();
    const listing = vi.spyOn(storage, "listObjectsPage");

    await expect(runDailyMaintenance()).resolves.toMatchObject({
      unused_files: "done",
      orphan_objects: "done",
    });
    // Only the stored files are listed, never the whole bucket.
    expect(listing.mock.calls.map(([prefix]) => prefix)).toEqual(["stored/"]);

    const kept = [oldReady, used];
    expect((await db.select().from(storedFiles)).map((row) => row.id).sort()).toEqual(
      kept.map((row) => row.id).sort()
    );
    expect([...storage.files.keys()].sort()).toEqual(
      [
        ...kept.map((row) => row.storageKey),
        "stored/young-orphan",
        `${foreignPrefix}/stored/orphan`,
      ].sort()
    );
  });

  it("counts a file's unused week from when a document last let go of it", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const storage = new MemoryObjectStore();
    objectStore.current = storage;
    const uploadedAt = new Date(Date.now() - 8 * DAY_MS);
    const file = {
      id: crypto.randomUUID(),
      storageKey: "stored/released-today",
      contentType: "image/webp",
      byteSize: 1,
      createdAt: uploadedAt,
    };
    await db.insert(storedFiles).values(file);
    await storage.upload(file.storageKey, Buffer.from("image"));
    storage.modifiedAt.set(file.storageKey, uploadedAt);
    const submitted = await submitSourceDocument({
      bookId: await testBookId(db),
      input: { text: null, storedFileIds: [file.id], documentDate: null },
    });
    // Deleting the record lets go of the file through the link's cascade.
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, submitted.document.id));

    await expect(runDailyMaintenance()).resolves.toMatchObject({ unused_files: "done" });

    const [row] = await db.select().from(storedFiles).where(eq(storedFiles.id, file.id));
    expect(row?.lastUsedAt?.getTime()).toBeGreaterThan(uploadedAt.getTime());
    expect(storage.files.has(file.storageKey)).toBe(true);
  });

  it("skips the steps not yet started once the process is stopping", async () => {
    const { db, storage } = await seed();

    const outcomes = await runDailyMaintenance({ signal: AbortSignal.abort() });

    expect(new Set(Object.values(outcomes))).toEqual(new Set(["skipped"]));
    expect(storage.files.has("stored/orphan")).toBe(true);
    expect(await db.select().from(storedFiles)).toHaveLength(3);
  });

  it("keeps the rest of the sweep going when a step fails", async () => {
    const { db, storage } = await seed();
    const listObjectsPage = storage.listObjectsPage.bind(storage);
    vi.spyOn(storage, "listObjectsPage").mockImplementation(async (prefix) => {
      if (prefix === "stored/") throw new Error("listing unavailable");
      return listObjectsPage(prefix);
    });

    await expect(runDailyMaintenance()).resolves.toMatchObject({
      unused_files: "done",
      orphan_objects: "failed",
    });

    expect(storage.files.has("stored/orphan")).toBe(true);
    expect(await db.select().from(storedFiles)).toHaveLength(2);
  });
});
