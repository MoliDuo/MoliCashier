import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { ledgerEntries } from "@/persistence";
import { ValidationError } from "@/lib/errors";
import {
  addLedgerEntry,
  batchUpdateLedgerEntries,
} from "@/modules/source-document/server/entry-commands";

async function fixture(amount: string, currency = "CNY") {
  const db = getTestDb();
  await createTestLedger(db);
  const record = await createTestRecord(db, {
    bookId: await testBookId(db),
    entryDate: "2026-01-05",
    entries: [{ categoryId: null, amount, currency, itemName: "Tea", description: null }],
  });
  const [entry] = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.sourceDocumentId, record.sourceDocumentId));
  const stored = async () =>
    db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entry!.id) });
  return { sourceDocumentId: record.sourceDocumentId, entryId: entry!.id, stored };
}

describe("batchUpdateLedgerEntries money", () => {
  it("keeps the amount when only the currency changes", async () => {
    const { sourceDocumentId, entryId, stored } = await fixture("12.00");

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryId],
      currency: "JPY",
    });

    expect(await stored()).toMatchObject({ amount: "12.000", currency: "JPY" });
  });

  it("refuses a currency the amount has too many decimals for, instead of rounding it", async () => {
    const { sourceDocumentId, entryId, stored } = await fixture("12.50");

    await expect(
      batchUpdateLedgerEntries({
        sourceDocumentIds: [sourceDocumentId],
        ledgerEntryIds: [entryId],
        currency: "JPY",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await stored()).toMatchObject({ amount: "12.500", currency: "CNY" });
  });

  it("rounds a new amount to the currency it is written in", async () => {
    const { sourceDocumentId, entryId, stored } = await fixture("12.50");

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryId],
      amount: "13.4",
      currency: "JPY",
    });

    expect(await stored()).toMatchObject({ amount: "13.000", currency: "JPY" });
  });
});

describe("addLedgerEntry money", () => {
  it("refuses an amount that rounds to zero in the entry's currency", async () => {
    const { sourceDocumentId } = await fixture("12.50");

    await expect(
      addLedgerEntry({ sourceDocumentId, amount: "0.004", itemName: "Crumb" })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addLedgerEntry({ sourceDocumentId, amount: "0.4", currency: "JPY", itemName: "Crumb" })
    ).rejects.toBeInstanceOf(ValidationError);
    const rows = await getTestDb()
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    expect(rows).toHaveLength(1);
  });
});
