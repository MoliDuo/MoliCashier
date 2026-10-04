import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type { Period } from "@/modules/ledger/domain/period";
import type { ForecastCommentaryDto, ForecastDto } from "./contracts";

/** 统计's forecast, served by `/api/ledger-queries`; null unless the period is still running. */
export const fetchForecast = (input: { bookId?: string; period: Period }) =>
  postLedgerQuery<ForecastDto | null>("forecast", [input]);

/** A few sentences from the model on the same forecast; asked for by a button, never cached. */
export const fetchForecastCommentary = (input: { bookId?: string; period: Period }) =>
  postLedgerQuery<ForecastCommentaryDto | null>("forecast-commentary", [input]);
