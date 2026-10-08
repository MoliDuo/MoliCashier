import "server-only";
import { createHash } from "node:crypto";
import {
  historyFingerprintText,
  judgmentVersionPrefix,
} from "@/modules/forecast/domain/judgment/fingerprint";
import type { HistoryRow } from "@/modules/forecast/domain/series";

/**
 * A digest of the rows recorded on or before `asOf`, the same whatever order they come in, led by the
 * judgment version, so a judgment made under an older prompt can be told apart.
 */
export function historyFingerprint(rows: readonly HistoryRow[], asOf: string): string {
  const hash = createHash("sha256")
    .update(historyFingerprintText(rows, asOf))
    .digest("hex")
    .slice(0, 32);
  return `${judgmentVersionPrefix()}${hash}`;
}
