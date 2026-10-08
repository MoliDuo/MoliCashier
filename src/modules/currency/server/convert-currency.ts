import "server-only";
import { AppError } from "@/lib/errors";
import type { ConvertCurrencyInput } from "../contract-schemas";
import type { ConvertCurrencyResult } from "../contracts";
import { convertAmount } from "./exchange-rates";
import { ledgerToday } from "@/modules/ledger/server/query-period";

/** A conversion for the ledger in `timeZone`; no stored rate for the day is a 409. */
export async function convertCurrency(
  input: ConvertCurrencyInput,
  timeZone: string
): Promise<ConvertCurrencyResult> {
  // Without a day the conversion is for today in the ledger's zone, the day
  // a record written now is filed under.
  const date = input.date ?? ledgerToday(timeZone);
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
