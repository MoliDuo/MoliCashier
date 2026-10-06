import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryRow } from "@/modules/forecast/domain/series";

const rows: HistoryRow[] = [
  { date: "2026-10-01", categoryId: "food", currency: "CNY", amount: "30", documentId: "d1" },
  { date: "2026-10-02", categoryId: "food", currency: "CNY", amount: "40", documentId: "d2" },
];

async function fingerprintUnder(version: number) {
  vi.resetModules();
  vi.doMock("@/config/tuning", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/config/tuning")>()),
    FORECAST_AI_JUDGMENT_VERSION: version,
  }));
  return import("@/modules/forecast/domain/judgment/fingerprint");
}

describe("historyFingerprint", () => {
  afterEach(() => {
    vi.doUnmock("@/config/tuning");
    vi.resetModules();
  });

  it("is the same whatever order the rows come in, and ignores rows after the day", async () => {
    const { historyFingerprint: fingerprint } = await fingerprintUnder(1);

    expect(fingerprint([...rows].reverse(), "2026-10-02")).toBe(fingerprint(rows, "2026-10-02"));
    expect(fingerprint(rows, "2026-10-01")).toBe(fingerprint(rows.slice(0, 1), "2026-10-01"));
    expect(fingerprint(rows, "2026-10-01")).not.toBe(fingerprint(rows, "2026-10-02"));
  });

  it("changes with the judgment version, so a judgment made under an older prompt is redone", async () => {
    const before = (await fingerprintUnder(1)).historyFingerprint(rows, "2026-10-02");
    const { historyFingerprint, isCurrentJudgmentVersion } = await fingerprintUnder(2);
    const after = historyFingerprint(rows, "2026-10-02");

    expect(after).not.toBe(before);
    expect(isCurrentJudgmentVersion(after)).toBe(true);
    expect(isCurrentJudgmentVersion(before)).toBe(false);
    // Stored before the version led the fingerprint.
    expect(isCurrentJudgmentVersion(after.slice(after.indexOf(":") + 1))).toBe(false);
  });
});
