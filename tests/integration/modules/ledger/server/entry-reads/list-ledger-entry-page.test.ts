import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { listLedgerEntryPage } from "@/modules/ledger/server/entry-reads/list-ledger-entry-page";
import { encodeLedgerEntryCursor } from "@/modules/ledger/server/entry-reads/build-ledger-entry-filters";
import { must } from "tests/helpers/must";

const entry = (itemName: string) => ({
  categoryId: null,
  amount: "1.00",
  currency: "CNY",
  itemName,
  description: null,
});

describe("listLedgerEntryPage cursor", () => {
  beforeEach(async () => {
    await createTestLedger(getTestDb());
  });

  it("walks entries whose documents differ below a millisecond without skipping or repeating", async () => {
    const db = getTestDb();
    const bookId = await testBookId(db);
    // Three documents on one date created within the same millisecond, each
    // with three entries, so page boundaries fall inside a document and
    // between documents whose created_at a JavaScript Date cannot tell apart.
    const created = [
      "2026-03-01 12:00:00.123456+00",
      "2026-03-01 12:00:00.123457+00",
      "2026-03-01 12:00:00.123458+00",
    ];
    for (const [index, createdAt] of created.entries()) {
      const { sourceDocumentId } = await createTestRecord(db, {
        bookId,
        entryDate: "2026-03-01",
        entries: [entry(`d${index}-a`), entry(`d${index}-b`), entry(`d${index}-c`)],
      });
      await db.execute(
        sql`UPDATE source_documents SET created_at = ${createdAt}::timestamptz WHERE id = ${sourceDocumentId}`
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 20; pages++) {
      const page: Awaited<ReturnType<typeof listLedgerEntryPage>> = await listLedgerEntryPage({
        limit: 2,
        cursor,
        filters: {},
      });
      seen.push(...page.items.map((item) => item.itemName));
      cursor = page.nextCursor;
      if (cursor == null) break;
    }

    // Newest document first, entries in position order within a document.
    expect(seen).toEqual(["d2-a", "d2-b", "d2-c", "d1-a", "d1-b", "d1-c", "d0-a", "d0-b", "d0-c"]);
  });

  it("still accepts a cursor with a millisecond timestamp from an older release", async () => {
    const db = getTestDb();
    const bookId = await testBookId(db);
    const older = await createTestRecord(db, {
      bookId,
      entryDate: "2026-03-01",
      entries: [entry("older")],
    });
    const newer = await createTestRecord(db, {
      bookId,
      entryDate: "2026-03-01",
      entries: [entry("newer")],
    });
    await db.execute(
      sql`UPDATE source_documents SET created_at = '2026-03-01 12:00:00.100+00' WHERE id = ${older.sourceDocumentId}`
    );
    await db.execute(
      sql`UPDATE source_documents SET created_at = '2026-03-01 12:00:00.200+00' WHERE id = ${newer.sourceDocumentId}`
    );
    const first = await listLedgerEntryPage({ limit: 10, filters: {} });
    const newerEntry = must(
      first.items.find((item) => item.itemName === "newer"),
      "newer entry"
    );

    const page = await listLedgerEntryPage({
      limit: 10,
      filters: {},
      cursor: encodeLedgerEntryCursor(
        {
          documentDate: "2026-03-01",
          documentCreatedAt: "2026-03-01T12:00:00.200Z",
          documentId: newer.sourceDocumentId,
          position: 0,
          entryId: newerEntry.id,
        },
        {}
      ),
    });

    expect(page.items.map((item) => item.itemName)).toEqual(["older"]);
  });
});
