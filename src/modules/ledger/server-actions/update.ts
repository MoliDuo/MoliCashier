"use server";
import { withLedgerAction } from "@/modules/ledger/action-access";
import { logError } from "@/lib/error-handlers";
import type { UpdateLedgerActionResult } from "@/modules/ledger/contracts";
import { parseUpdateLedgerInput, type UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import { updateLedgerSettings } from "../server/settings";
import { toUpdateLedgerActionErrorCode } from "./update-error";

export const updateLedgerSettingsAction = withLedgerAction(
  async (data: UpdateLedgerInput): Promise<UpdateLedgerActionResult> => {
    try {
      const validated = parseUpdateLedgerInput(data);
      return {
        ok: true,
        ledger: await updateLedgerSettings(validated),
      };
    } catch (error) {
      const code = toUpdateLedgerActionErrorCode(error);
      // This settings action intentionally returns a result code so callers
      // can explain a rejected value. Other simple commands continue to throw
      // their typed application errors at the boundary.
      if (code === "unexpected") logError("updateLedgerSettingsAction", error);
      return { ok: false, code };
    }
  }
);
