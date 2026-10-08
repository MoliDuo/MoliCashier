import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import {
  books,
  entryCategories,
  extractionAttempts,
  ledgerEntries,
  ledgerSyncState,
  ledgers,
  serviceCredentials,
} from "@/persistence";

/** The row as the triggers keep it. */
async function syncState() {
  const state = await getTestDb().query.ledgerSyncState.findFirst();
  if (state == null) throw new Error("Expected a sync row for the ledger");
  return { version: state.version };
}

describe("record_ledger_change trigger", () => {
  it("advances the ledger version once per transaction, however many rows change", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db);
    const before = await syncState();

    await db.transaction(async (tx) => {
      await tx.insert(ledgerEntries).values(
        ["Coffee", "Bagel", "Juice"].map((itemName, position) => ({
          sourceDocumentId,
          position,
          itemName,
          amount: "1.00",
          currency: "CNY",
        }))
      );
      await tx
        .update(ledgerEntries)
        .set({ amount: "2.00" })
        .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    });

    const after = await syncState();
    expect(after.version).toBe(before.version + BigInt(1));
  });

  it("moves the version for an attempt, a category, a setting and the main currency", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db, { status: "processing" });

    const initial = await syncState();
    await db
      .update(extractionAttempts)
      .set({ status: "cancelled" })
      .where(eq(extractionAttempts.sourceDocumentId, sourceDocumentId));
    const afterAttempt = await syncState();
    expect(afterAttempt.version).toBe(initial.version + BigInt(1));

    await db.insert(entryCategories).values({ name: "Snacks" });
    const afterCategory = await syncState();
    expect(afterCategory.version).toBe(afterAttempt.version + BigInt(1));

    await db.update(ledgers).set({ aiCustomPrompt: "Be brief" });
    const afterSetting = await syncState();
    expect(afterSetting.version).toBe(afterCategory.version + BigInt(1));

    await db.update(ledgers).set({ mainCurrency: "USD" });
    expect((await syncState()).version).toBe(afterSetting.version + BigInt(1));
  });

  it("moves the version for a book, an API key and the ledger's zone, not a key's use", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    const [book] = await db
      .insert(books)
      .values({ name: "旅行", sortOrder: 9 })
      .returning({ id: books.id });
    const afterBook = await syncState();

    const [credential] = await db
      .insert(serviceCredentials)
      .values({
        bookId: book!.id,
        name: "Shortcut",
        tokenHash: "a".repeat(64),
        tokenPrefix: "csh_abcd",
        tokenSuffix: "wxyz",
      })
      .returning({ id: serviceCredentials.id });
    const afterKey = await syncState();
    expect(afterKey.version).toBe(afterBook.version + BigInt(1));

    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(serviceCredentials.id, credential!.id));
    expect((await syncState()).version).toBe(afterKey.version);

    await db.update(ledgers).set({ timeZone: "Europe/Paris" });
    const afterZone = await syncState();
    expect(afterZone.version).toBe(afterKey.version + BigInt(1));
  });

  it("creates the sync row on the first change", async () => {
    const db = getTestDb();
    await createTestLedger(db);
    await db.delete(ledgerSyncState);

    await createTestSourceDocument(db);
    expect((await syncState()).version).toBeGreaterThan(BigInt(0));
    await expect(db.select().from(ledgerSyncState)).resolves.toHaveLength(1);
  });
});
