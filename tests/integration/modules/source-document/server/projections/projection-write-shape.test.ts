import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { claimAttemptForTest, createPendingAttempt } from "tests/helpers/processing-attempt";
import type { LedgerProjectionEntryContract } from "@/modules/source-document/server/projections/types";
import { createTestLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import {
  ledgerEntries,
  ledgerSyncState,
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import {
  addLedgerEntry,
  batchUpdateLedgerEntries,
  deleteLedgerEntry,
} from "@/modules/source-document/server/entry-commands";
import { must } from "tests/helpers/must";

type TestDatabase = ReturnType<typeof getTestDb>;

function entry(
  itemName: string,
  overrides: Partial<LedgerProjectionEntryContract> = {}
): LedgerProjectionEntryContract {
  return {
    categoryId: null,
    amount: "10.00",
    currency: "CNY",
    itemName,
    description: null,
    ...overrides,
  };
}

// Statement-level triggers count how many SQL statements mutate a table. The
// counters run inside the same transaction as the write under test, so they
// measure statement count (not row count) regardless of batch size.
async function installStatementCounters(
  db: TestDatabase,
  counters: Array<{ table: string; operation: "INSERT" | "UPDATE"; name: string }>
) {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS statement_counters (
    name text PRIMARY KEY,
    value integer NOT NULL DEFAULT 0
  )`)
  );
  for (const counter of counters) {
    const functionName = `bump_statement_counter_${counter.name}`;
    const triggerName = `trg_count_${counter.name}`;
    await db.execute(
      sql.raw(`CREATE OR REPLACE FUNCTION ${functionName}()
        RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          UPDATE statement_counters SET value = value + 1 WHERE name = '${counter.name}';
          RETURN NULL;
        END $fn$`)
    );
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON ${counter.table}`));
    await db.execute(
      sql.raw(`CREATE TRIGGER ${triggerName}
        AFTER ${counter.operation} ON ${counter.table}
        FOR EACH STATEMENT EXECUTE FUNCTION ${functionName}()`)
    );
    await db.execute(
      sql.raw(`INSERT INTO statement_counters (name, value)
        VALUES ('${counter.name}', 0)
        ON CONFLICT (name) DO UPDATE SET value = 0`)
    );
  }
}

async function readStatementCounter(db: TestDatabase, name: string): Promise<number> {
  const rows = await db.execute<{ value: number }>(
    sql`SELECT value FROM statement_counters WHERE name = ${name}`
  );
  return rows.rows[0]?.value ?? 0;
}

describe("projection write shape", () => {
  beforeEach(async () => {
    await createTestLedger(getTestDb());
  });

  it("inserts 1, 50 and 500 projection entries with one statement each", async () => {
    const db = getTestDb();
    await installStatementCounters(db, [
      { table: "ledger_entries", operation: "INSERT", name: "ledger_entries_insert" },
    ]);

    for (const count of [1, 50, 500]) {
      const pending = await createPendingAttempt({
        input: { text: `Doc ${count}`, storedFileIds: [], documentDate: null },
        bookId: await testBookId(db),
      });
      const created = { sourceDocumentId: pending.attempt.sourceDocumentId };
      await activateAttempt({
        lease: await claimAttemptForTest(pending.attempt.id),
        sourceDocumentId: pending.attempt.sourceDocumentId,
        attemptId: pending.attempt.id,
        entries: Array.from({ length: count }, (_, index) =>
          entry(`Item ${index}`, { amount: String(index + 1) })
        ),
      });

      expect(await readStatementCounter(db, "ledger_entries_insert")).toBe(1);
      const rows = await db
        .select({ id: ledgerEntries.id })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId));
      expect(rows).toHaveLength(count);
      await db.execute(
        sql.raw(`UPDATE statement_counters SET value = 0 WHERE name = 'ledger_entries_insert'`)
      );
    }
  });

  it("edits a document's entries without duplicating its files or entries", async () => {
    const db = getTestDb();
    const created = await createTestRecord(getTestDb(), {
      title: "With file",
      entries: [entry("A"), entry("B")],
      bookId: await testBookId(db),
    });
    const file = (
      await db
        .insert(storedFiles)
        .values({
          storageKey: `tests/${created.sourceDocumentId}/0`,
          contentType: "image/jpeg",
          byteSize: 100,
        })
        .returning()
    )[0];
    if (file == null) throw new Error("Expected stored file insert to return a row");
    await db.insert(sourceDocumentFiles).values({
      sourceDocumentId: created.sourceDocumentId,
      storedFileId: file.id,
      position: 0,
    });
    await installStatementCounters(db, [
      {
        table: "source_document_files",
        operation: "INSERT",
        name: "source_document_files_insert",
      },
    ]);

    await addLedgerEntry({
      sourceDocumentId: created.sourceDocumentId,
      amount: "10",
      currency: "CNY",
      itemName: "C",
    });

    expect(await readStatementCounter(db, "source_document_files_insert")).toBe(0);

    // Existing evidence keeps its position on the document.
    const files = await db
      .select({
        storedFileId: sourceDocumentFiles.storedFileId,
        position: sourceDocumentFiles.position,
      })
      .from(sourceDocumentFiles)
      .where(eq(sourceDocumentFiles.sourceDocumentId, created.sourceDocumentId));
    expect(files).toEqual([{ storedFileId: file.id, position: 0 }]);

    // A hand edit records no parse attempt.
    expect(
      await db
        .select()
        .from(extractionAttempts)
        .where(eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId))
    ).toHaveLength(0);
    const allEntries = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId));
    expect(allEntries).toHaveLength(3);
    const liveEntries = await db
      .select({
        position: ledgerEntries.position,
        itemName: ledgerEntries.itemName,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId))
      .orderBy(ledgerEntries.position);
    expect(liveEntries).toEqual([
      { position: 0, itemName: "A" },
      { position: 1, itemName: "B" },
      { position: 2, itemName: "C" },
    ]);
  });

  it("preserves entry identity and order without history copies, and increments change-log version", async () => {
    const db = getTestDb();
    const pinnedCreatedAt = new Date("2026-01-02T03:04:05.000Z");
    const created = await createTestRecord(getTestDb(), {
      title: "Manual",
      entryDate: "2026-05-01",
      entries: [
        entry("One", { id: "11111111-1111-4111-8111-111111111111" }),
        entry("Two", {
          id: "22222222-2222-4222-8222-222222222222",
          createdAt: pinnedCreatedAt.toISOString(),
        }),
        entry("Three", { id: "33333333-3333-4333-8333-333333333333" }),
      ],
      bookId: await testBookId(db),
    });
    const originalRows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId));
    const originalById = new Map(originalRows.map((row) => [row.id, row]));
    const versionAfterCreate = (
      await db.select({ version: ledgerSyncState.version }).from(ledgerSyncState)
    )[0]?.version;
    await installStatementCounters(db, [
      { table: "ledger_entries", operation: "INSERT", name: "ledger_entries_insert" },
      { table: "ledger_entries", operation: "UPDATE", name: "ledger_entries_update" },
    ]);

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [created.sourceDocumentId],
      ledgerEntryIds: originalRows.map((row) => row.id),
      description: "updated",
    });

    // No archive INSERT; one set-based UPDATE, independent of row count.
    expect(await readStatementCounter(db, "ledger_entries_insert")).toBe(0);
    expect(await readStatementCounter(db, "ledger_entries_update")).toBe(1);

    // The document's entries: input order, retained ids and created_at intact.
    const activeRows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId))
      .orderBy(ledgerEntries.position);
    expect(activeRows.map((row) => [row.itemName, row.description])).toEqual([
      ["One", "updated"],
      ["Two", "updated"],
      ["Three", "updated"],
    ]);
    for (const row of activeRows) {
      const original = must(originalById.get(row.id), `original row for ${row.id}`);
      expect(row.createdAt.getTime()).toBe(original.createdAt.getTime());
    }

    // The change-log trigger aggregates by transaction: exactly one version
    // bump for the whole replace.
    const versionAfterReplace = (
      await db.select({ version: ledgerSyncState.version }).from(ledgerSyncState)
    )[0]?.version;
    expect(Number(versionAfterReplace)).toBe(Number(versionAfterCreate) + 1);
  });

  it("leaves entries an edit does not change as they were", async () => {
    const db = getTestDb();
    const created = await createTestRecord(getTestDb(), {
      title: "Manual",
      entryDate: "2026-05-01",
      entries: [
        entry("Kept", { id: "44444444-4444-4444-8444-444444444444" }),
        entry("Edited", { id: "55555555-5555-4555-8555-555555555555" }),
      ],
      bookId: await testBookId(db),
    });
    const staleUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    await db
      .update(ledgerEntries)
      .set({ updatedAt: staleUpdatedAt })
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId));

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [created.sourceDocumentId],
      ledgerEntryIds: ["55555555-5555-4555-8555-555555555555"],
      itemName: "Edited again",
    });

    const rows = await db
      .select({ itemName: ledgerEntries.itemName, updatedAt: ledgerEntries.updatedAt })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId))
      .orderBy(ledgerEntries.position);
    expect(rows[0]).toEqual({ itemName: "Kept", updatedAt: staleUpdatedAt });
    expect(rows[1]?.itemName).toBe("Edited again");
    expect(rows[1]?.updatedAt).not.toEqual(staleUpdatedAt);
  });

  it("reuses positions across repeated removals and additions without creating attempts", async () => {
    const db = getTestDb();
    const created = await createTestRecord(getTestDb(), {
      title: "Repeated edits",
      entries: [entry("Keep"), entry("Replace")],
      bookId: await testBookId(db),
    });
    for (let iteration = 0; iteration < 3; iteration++) {
      const rows = await db.query.ledgerEntries.findMany({
        where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
        orderBy: ledgerEntries.position,
      });
      expect(
        await deleteLedgerEntry({
          sourceDocumentId: created.sourceDocumentId,
          ledgerEntryId: rows[1]!.id,
        })
      ).toEqual({ ledgerEntryId: rows[1]!.id, deleted: true });
      expect(
        await addLedgerEntry({
          sourceDocumentId: created.sourceDocumentId,
          amount: "10",
          currency: "CNY",
          itemName: `Replacement ${iteration}`,
        })
      ).toEqual({ ledgerEntryId: expect.any(String) });
    }
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    // Each entry add and delete changes whole-save content and bumps the version once.
    expect(document).toMatchObject({ version: 7 });
    expect(
      await db.query.extractionAttempts.findMany({
        where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
      })
    ).toHaveLength(0);
    const rows = await db.query.ledgerEntries.findMany({
      where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
      orderBy: ledgerEntries.position,
    });
    expect(rows.map(({ position, itemName }) => ({ position, itemName }))).toEqual([
      { position: 0, itemName: "Keep" },
      { position: 1, itemName: "Replacement 2" },
    ]);
  });
});
