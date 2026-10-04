import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObjectStore } from "@/lib/storage";
import { setAiTransportForTests } from "@/lib/ai/client";
import { aiCorrections, entryCategories } from "@/persistence";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { fakeAiTransport } from "tests/helpers/fake-ai";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

import { runDailyMaintenance } from "@/server/maintenance/daily";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => setAiTransportForTests(null));

async function seed(corrections: { consumedAt: Date | null; updatedAt: Date }[]) {
  const db = getTestDb();
  await createTestLedger(db);
  objectStore.current = new MemoryObjectStore();
  await db.insert(entryCategories).values([{ name: "餐饮", sortOrder: 1 }]);
  const record = await createTestRecord(db, { bookId: await testBookId(db), entries: [] });
  await db.insert(aiCorrections).values(
    corrections.map((correction, index) => ({
      sourceDocumentId: record.sourceDocumentId,
      subjectId: crypto.randomUUID(),
      field: "item_name" as const,
      beforeValue: `before ${index}`,
      afterValue: `after ${index}`,
      ...correction,
    }))
  );
  return db;
}

describe("daily maintenance and the owner's corrections", () => {
  it("distills unread corrections as its own step", async () => {
    const now = new Date();
    const db = await seed(
      Array.from({ length: 3 }, () => ({
        consumedAt: null,
        updatedAt: new Date(now.getTime() - 1000),
      }))
    );
    setAiTransportForTests(fakeAiTransport(() => JSON.stringify({ preferences: ["学到的偏好"] })));

    const outcomes = await runDailyMaintenance({ now });

    expect(outcomes.preference_learning).toBe("done");
    expect((await db.query.ledgers.findFirst())?.aiLearnedPreferences).toBe("- 学到的偏好");
  });

  it("keeps going when the model is unavailable", async () => {
    const now = new Date();
    await seed(
      Array.from({ length: 3 }, () => ({
        consumedAt: null,
        updatedAt: new Date(now.getTime() - 1000),
      }))
    );
    setAiTransportForTests(
      fakeAiTransport(() => {
        throw new Error("provider down");
      })
    );

    const outcomes = await runDailyMaintenance({ now });

    expect(outcomes.preference_learning).toBe("failed");
    expect(outcomes.unused_files).toBe("done");
  });

  it("deletes read corrections after the retention window and keeps the rest", async () => {
    const now = new Date();
    const db = await seed([
      {
        consumedAt: new Date(now.getTime() - 181 * DAY_MS),
        updatedAt: new Date(now.getTime() - 181 * DAY_MS),
      },
      {
        consumedAt: new Date(now.getTime() - 100 * DAY_MS),
        updatedAt: new Date(now.getTime() - 100 * DAY_MS),
      },
      { consumedAt: null, updatedAt: new Date(now.getTime() - 300 * DAY_MS) },
    ]);

    await runDailyMaintenance({ now });

    const remaining = await db.query.aiCorrections.findMany({
      orderBy: (row, { asc }) => [asc(row.afterValue)],
    });
    expect(remaining.map((row) => row.afterValue)).toEqual(["after 1", "after 2"]);
  });
});
