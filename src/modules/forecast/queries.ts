import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type { Period } from "@/modules/ledger/domain/period";
import type { ForecastDto } from "./contracts";

/** 统计's forecast, served by `/api/ledger-queries`; null unless the period is still running. */
export const fetchForecast = (input: { bookId?: string; period: Period }) =>
  postLedgerQuery<ForecastDto | null>("forecast", [input]);
