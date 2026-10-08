import { describe, expect, it } from "vitest";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { buildSourceDocumentDetailViewModel } from "@/modules/source-document/ui/source-document-detail-view-model";

const entry: LedgerEntryDto = {
  id: "entry-1",
  categoryId: null,
  sourceDocumentId: "document-1",
  amount: "10",
  currency: "USD",
  itemName: "Coffee",
  description: null,
  convertedAmount: "70",
  exchangeRate: "7",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function build(
  entryDate: string,
  entries: Record<string, { currency?: string; amount?: string }> = {},
  mainCurrency = "CNY",
  ledgerEntry = entry
) {
  return buildSourceDocumentDetailViewModel({
    ledgerEntries: [ledgerEntry],
    pendingChanges: { entries },
    mainCurrency,
    entryDate,
    originalEntryDate: "2026-08-01",
  });
}

describe("source document detail conversion view model", () => {
  it("reuses the stored conversion only while currency and date identity match", () => {
    expect(build("2026-08-01")).toMatchObject({
      totalInMainCurrency: "70",
      unconvertedCount: 0,
    });
  });

  it("preserves the persisted accounting amount instead of recomputing a rounded rate", () => {
    const result = build("2026-08-01", {}, "KWD", {
      ...entry,
      amount: "2",
      convertedAmount: "2.470",
      exchangeRate: "1.23456",
    });

    expect(result.displayEntries[0]?.convertedAmount).toBe("2.47");
    expect(result.totalInMainCurrency).toBe("2.47");
  });

  it("marks a foreign entry as pending recalculation (not missing a rate) when its date changes", () => {
    // A date edit invalidates the persisted conversion without ever
    // consulting a rate for the new date, so this must not be reported as a
    // real "missing exchange rate" (unconvertedCount) — it's expected to
    // resolve once the entry is saved and recalculated server-side.
    const result = build("2026-08-02");
    expect(result.displayEntries[0]).toMatchObject({ exchangeRate: null, convertedAmount: null });
    expect(result.totalInMainCurrency).toBe("0");
    expect(result.unconvertedCount).toBe(0);
    expect(result.staleConversionCount).toBe(1);
  });

  it("marks a foreign entry as pending recalculation when its edited currency changes", () => {
    const result = build("2026-08-01", { "entry-1": { currency: "EUR" } });
    expect(result.displayEntries[0]).toMatchObject({ currency: "EUR", convertedAmount: null });
    expect(result.unconvertedCount).toBe(0);
    expect(result.staleConversionCount).toBe(1);
  });

  it("reports a real missing exchange rate when identity is unchanged but no rate is stored", () => {
    const result = build("2026-08-01", {}, "CNY", {
      ...entry,
      convertedAmount: null,
      exchangeRate: null,
    });
    expect(result.displayEntries[0]).toMatchObject({ convertedAmount: null });
    expect(result.unconvertedCount).toBe(1);
    expect(result.staleConversionCount).toBe(0);
  });

  it("does not flag a same-currency entry as pending recalculation on a date change", () => {
    const result = build("2026-08-02", {}, "USD", { ...entry, currency: "USD" });
    expect(result.staleConversionCount).toBe(0);
  });

  it("rounds recalculated conversions to zero-decimal main currencies", () => {
    const result = build("2026-08-01", { "entry-1": { amount: "2" } }, "JPY", {
      ...entry,
      exchangeRate: "1.23456",
    });

    expect(result.displayEntries[0]?.convertedAmount).toBe("2");
    expect(result.totalInMainCurrency).toBe("2");
  });

  it("rounds recalculated conversions to three-decimal main currencies", () => {
    const result = build("2026-08-01", { "entry-1": { amount: "2" } }, "KWD", {
      ...entry,
      exchangeRate: "1.23456",
    });

    expect(result.displayEntries[0]?.convertedAmount).toBe("2.469");
    expect(result.totalInMainCurrency).toBe("2.469");
  });
});
