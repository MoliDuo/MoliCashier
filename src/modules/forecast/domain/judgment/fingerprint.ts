import { createHash } from "node:crypto";
import { FORECAST_AI_JUDGMENT_VERSION } from "@/config/tuning";
import type { HistoryRow } from "@/modules/forecast/domain/series";

/**
 * A digest of the rows recorded on or before `asOf`, the same whatever order they come in, and of the
 * judgment version, so a judgment made under an older prompt no longer stands for the history.
 */
export function historyFingerprint(rows: readonly HistoryRow[], asOf: string): string {
  const lines = rows
    .filter((row) => row.date <= asOf)
    .map((row) => `${row.date}|${row.documentId ?? ""}|${row.categoryId ?? ""}|${row.amount}`)
    .sort();
  return createHash("sha256")
    .update(`v${FORECAST_AI_JUDGMENT_VERSION}\n${lines.join("\n")}`)
    .digest("hex")
    .slice(0, 32);
}
