import { createHash } from "node:crypto";
import { FORECAST_AI_JUDGMENT_VERSION } from "@/config/tuning";
import type { HistoryRow } from "@/modules/forecast/domain/series";

const versionPrefix = () => `v${FORECAST_AI_JUDGMENT_VERSION}:`;

/**
 * A digest of the rows recorded on or before `asOf`, the same whatever order they come in, led by the
 * judgment version, so a judgment made under an older prompt can be told apart.
 */
export function historyFingerprint(rows: readonly HistoryRow[], asOf: string): string {
  const lines = rows
    .filter((row) => row.date <= asOf)
    .map((row) => `${row.date}|${row.documentId ?? ""}|${row.categoryId ?? ""}|${row.amount}`)
    .sort();
  const hash = createHash("sha256")
    .update(`v${FORECAST_AI_JUDGMENT_VERSION}\n${lines.join("\n")}`)
    .digest("hex")
    .slice(0, 32);
  return `${versionPrefix()}${hash}`;
}

/** Whether a judgment stored with `fingerprint` was made under the current prompt. */
export function isCurrentJudgmentVersion(fingerprint: string): boolean {
  return fingerprint.startsWith(versionPrefix());
}
