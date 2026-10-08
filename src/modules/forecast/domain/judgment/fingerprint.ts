import { FORECAST_AI_JUDGMENT_VERSION } from "@/config/tuning";
import type { HistoryRow } from "@/modules/forecast/domain/series";

/** What every fingerprint made under the current judgment version starts with. */
export const judgmentVersionPrefix = () => `v${FORECAST_AI_JUDGMENT_VERSION}:`;

/**
 * The text a history fingerprint digests: the rows recorded on or before `asOf`, the same whatever
 * order they come in, after the judgment version. The digest itself is `historyFingerprint` in
 * `server/history-fingerprint.ts`.
 */
export function historyFingerprintText(rows: readonly HistoryRow[], asOf: string): string {
  const lines = rows
    .filter((row) => row.date <= asOf)
    .map((row) => `${row.date}|${row.documentId ?? ""}|${row.categoryId ?? ""}|${row.amount}`)
    .sort();
  return `v${FORECAST_AI_JUDGMENT_VERSION}\n${lines.join("\n")}`;
}

/** Whether a judgment stored with `fingerprint` was made under the current prompt. */
export function isCurrentJudgmentVersion(fingerprint: string): boolean {
  return fingerprint.startsWith(judgmentVersionPrefix());
}
