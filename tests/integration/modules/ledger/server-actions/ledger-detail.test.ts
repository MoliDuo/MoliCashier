import { describe, it, expect } from "vitest";
import { updateLedgerSettingsAction } from "@/modules/ledger/server-actions/update";
import { getTestDb } from "tests/setup";
import { ledgers } from "@/persistence";
import { createTestLedger } from "tests/helpers/schema-setup";
import { NotFoundError } from "@/lib/errors";
import { insertExchangeRates } from "tests/helpers/exchange-rates";

// Helper to clean up and create the test ledger
async function setupTestLedger(db: ReturnType<typeof getTestDb>) {
  await db.delete(ledgers);
  await createTestLedger(db);
}

describe("Ledger Actions", () => {
  it("should update ledger settings", async () => {
    const db = getTestDb();
    await setupTestLedger(db);
    await insertExchangeRates("2026-08-22", { USD: 1, CNY: 8 });

    const result = await updateLedgerSettingsAction({
      settings: {
        mainCurrency: "USD",
        aiLanguage: "en",
        currencies: ["USD", "CNY"],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ledger.settings.mainCurrency).toBe("USD");
    expect(result.ledger.settings.aiLanguage).toBe("en");
    expect(result.ledger.settings.currencies).toEqual(["USD", "CNY"]);
  });

  it("rejects when there is no live ledger (Update)", async () => {
    await expect(
      updateLedgerSettingsAction({ settings: { mainCurrency: "USD" } })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
