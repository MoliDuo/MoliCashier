import "server-only";
import { AppError } from "@/lib/errors";
import { withLedgerAccess } from "@/modules/ledger/access";
import { parseConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { convertAmount } from "./exchange-rates";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { ledgerToday } from "@/modules/ledger/server/query-period";

/** A conversion for the signed-in ledger; no stored rate for the day is a 409. */
export const convertCurrency = withLedgerAccess(
  async (rawInput: unknown): Promise<ConvertCurrencyResult> => {
    const input = parseConvertCurrencyInput(rawInput);
    // Without a day the conversion is for today in the ledger's zone, the day
    // a record written now is filed under.
    const date = input.date ?? ledgerToday((await getLedgerSettings())?.timeZone ?? "UTC");
    const converted = await convertAmount({
      amount: input.amount,
      fromCurrency: input.from,
      toCurrency: input.to,
      date,
    });
    if (converted == null) {
      throw new AppError("No exchange rate is available", "EXCHANGE_RATES_UNAVAILABLE", 409);
    }
    return { converted };
  }
);
