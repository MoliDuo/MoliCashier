import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { aiCorrections, ledgers } from "@/persistence";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { mapLedgerSettings } from "./settings";

/**
 * Forgets what was learned: the text and the corrections it came from, so the
 * next run starts from nothing instead of rebuilding the same list.
 */
export async function clearLearnedPreferences(): Promise<LedgerDto> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(ledgers)
      .set({ aiLearnedPreferences: "", aiLearnedPreferencesUpdatedAt: null })
      .returning();
    if (updated == null) throw new NotFoundError("Ledger");
    await tx.delete(aiCorrections);
    return {
      settings: mapLedgerSettings(updated),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}
