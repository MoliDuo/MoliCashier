import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { listTargetSourceDocuments } from "@/modules/source-document/server/reads/list";
import { encodeSourceDocumentPageCursor } from "@/modules/source-document/domain/stream-cursor";

async function createDocumentAt(bookId: string, title: string, createdAt: string) {
  const db = getTestDb();
  const { sourceDocumentId } = await createTestRecord(db, {
    bookId,
    title,
    entryDate: "2026-03-01",
    entries: [],
  });
  await db.execute(
    sql`UPDATE source_documents SET created_at = ${createdAt}::timestamptz WHERE id = ${sourceDocumentId}`
  );
  return sourceDocumentId;
}

describe("listTargetSourceDocuments cursor", () => {
  beforeEach(async () => {
    await createTestLedger(getTestDb());
  });

  it("pages through documents created within one millisecond without skipping or repeating", async () => {
    const bookId = await testBookId(getTestDb());
    for (const [index, createdAt] of [
      "2026-03-01 12:00:00.123456+00",
      "2026-03-01 12:00:00.123457+00",
      "2026-03-01 12:00:00.123458+00",
      "2026-03-01 12:00:00.123459+00",
    ].entries()) {
      await createDocumentAt(bookId, `doc-${index}`, createdAt);
    }

    const seen: (string | null)[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages++) {
      const page: Awaited<ReturnType<typeof listTargetSourceDocuments>> =
        await listTargetSourceDocuments({ limit: 1, cursor });
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
      if (cursor == null) break;
    }

    expect(seen).toEqual(["doc-3", "doc-2", "doc-1", "doc-0"]);
  });

  it("still accepts a page cursor with a millisecond timestamp from an older release", async () => {
    const bookId = await testBookId(getTestDb());
    await createDocumentAt(bookId, "older", "2026-03-01 12:00:00.100+00");
    const newerId = await createDocumentAt(bookId, "newer", "2026-03-01 12:00:00.200+00");

    const page = await listTargetSourceDocuments({
      limit: 10,
      cursor: encodeSourceDocumentPageCursor({
        documentDate: "2026-03-01",
        createdAt: "2026-03-01T12:00:00.200Z",
        id: newerId,
      }),
    });

    expect(page.items.map((item) => item.title)).toEqual(["older"]);
  });
});
