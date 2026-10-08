import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getStreamRefresh } from "@/modules/source-document/server/stream-refresh";
import { ledgers, extractionAttempts, sourceDocuments } from "@/persistence";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

describe("ledger refresh", () => {
  beforeEach(async () => {
    await createTestLedger(getTestDb());
  });

  const refresh = (afterVersion: string) => getStreamRefresh({ afterVersion });
  // Pages loaded before this release still read these flags; they stay, all false, for one more.
  const retired = { categories: false, settings: false, stats: false };

  async function version(): Promise<bigint> {
    const state = await getTestDb().query.ledgerSyncState.findFirst();
    return state?.version ?? BigInt(0);
  }

  it("still answers the retired invalidation flags, all false, for pages from the last release", async () => {
    const result = await refresh("0");

    expect(result.invalidations).toEqual(retired);
  });

  it("returns no change at the current version", async () => {
    const currentVersion = await version();
    await expect(refresh(currentVersion.toString())).resolves.toEqual({
      version: currentVersion.toString(),
      changed: false,
      hasTransitionalWork: false,
      invalidations: retired,
    });
  });

  it("summarizes continuous document and settings changes", async () => {
    await createTestSourceDocument(getTestDb(), { title: "Refresh receipt" });
    const afterDocument = await version();
    await getTestDb().update(ledgers).set({ aiLanguage: "en" });

    expect(await refresh(afterDocument.toString())).toEqual({
      version: (await version()).toString(),
      changed: true,
      hasTransitionalWork: false,
      invalidations: retired,
    });
  });

  it("reports a change to a client that has never refreshed", async () => {
    await createTestSourceDocument(getTestDb());
    await getTestDb().update(ledgers).set({ aiLanguage: "en" });
    expect(await refresh("0")).toMatchObject({
      changed: true,
    });
  });

  it("coalesces a transaction and rolls back its version", async () => {
    const before = await version();
    await getTestDb().transaction(async (tx) => {
      await tx.update(ledgers).set({ aiLanguage: "en" });
      await tx.update(ledgers).set({ aiLanguage: "zh-CN" });
    });
    expect(await version()).toBe(before + BigInt(1));
    const committed = await refresh(before.toString());
    await expect(
      getTestDb().transaction(async (tx) => {
        await tx.update(ledgers).set({ mainCurrency: "USD" });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    expect(await refresh(before.toString())).toEqual(committed);
  });

  it("reports a change after a main-currency reset", async () => {
    const before = await version();
    await getTestDb().update(ledgers).set({ mainCurrency: "USD" });

    expect(await refresh(before.toString())).toMatchObject({
      changed: true,
    });
  });

  it.each(["invalid", "9223372036854775808"])(
    "reports a change for invalid version %s",
    async (afterVersion) => {
      expect(await refresh(afterVersion)).toMatchObject({
        changed: true,
      });
    }
  );

  it("reports a change for a future version", async () => {
    const current = await version();
    expect(await refresh((current + BigInt(1)).toString())).toMatchObject({
      version: current.toString(),
      changed: true,
    });
  });

  it("reports processing work until the document reaches a terminal state", async () => {
    const documentId = await createTestSourceDocument(getTestDb(), {
      status: "processing",
    });
    const processing = await refresh("0");
    expect(processing.hasTransitionalWork).toBe(true);

    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, documentId),
      columns: { latestAttemptId: true },
    });
    const attemptId = document?.latestAttemptId;
    if (attemptId == null) throw new Error("Expected processing attempt");
    await getTestDb()
      .update(extractionAttempts)
      .set({ status: "completed", finishedAt: new Date() })
      .where(eq(extractionAttempts.id, attemptId));
    expect((await refresh(processing.version)).hasTransitionalWork).toBe(false);
  });
});
