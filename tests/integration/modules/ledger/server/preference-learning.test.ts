import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { setAiTransportForTests } from "@/lib/ai/client";
import { aiCorrections, entryCategories, ledgers, sourceDocuments } from "@/persistence";
import { runPreferenceLearning } from "@/modules/ledger/server/preference-learning";
import { clearLearnedPreferences } from "@/modules/ledger/server/learned-preferences";
import { updateLedgerSettings } from "@/modules/ledger/server/settings";
import { fakeAiTransport } from "tests/helpers/fake-ai";
import { createTestLedger, createTestRecord, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

afterEach(() => setAiTransportForTests(null));

async function createFixture(correctionCount: number) {
  const db = getTestDb();
  await createTestLedger(db);
  await db.insert(entryCategories).values([
    { name: "餐饮", sortOrder: 1 },
    { name: "交通", sortOrder: 2 },
  ]);
  const record = await createTestRecord(db, {
    bookId: await testBookId(db),
    title: "滴滴出行",
    entries: [],
  });
  const base = new Date("2026-10-01T00:00:00.000Z");
  const rows = Array.from({ length: correctionCount }, (_, index) => ({
    sourceDocumentId: record.sourceDocumentId,
    subjectId: crypto.randomUUID(),
    field: "category" as const,
    documentTitle: "滴滴出行",
    itemName: `快车 ${index}`,
    amount: "23.500",
    currency: "CNY",
    beforeValue: "餐饮",
    afterValue: "交通",
    updatedAt: new Date(base.getTime() + index * 1000),
  }));
  if (rows.length > 0) await db.insert(aiCorrections).values(rows);
  return { db, record };
}

const ledgerRow = () => getTestDb().query.ledgers.findFirst();
const unconsumed = () =>
  getTestDb().query.aiCorrections.findMany({
    where: (row, { isNull }) => isNull(row.consumedAt),
  });
const NOW = new Date("2026-10-02T00:00:00.000Z");

describe("preference learning", () => {
  it("does not call the model with fewer corrections than a run needs", async () => {
    await createFixture(2);
    const transport = fakeAiTransport(() => JSON.stringify({ preferences: ["x"] }));
    setAiTransportForTests(transport);

    await expect(runPreferenceLearning({ now: NOW })).resolves.toBe("not_enough");

    expect(transport.complete).not.toHaveBeenCalled();
    expect(await unconsumed()).toHaveLength(2);
  });

  it("writes the learned text, stamps it, and marks the corrections as read", async () => {
    await createFixture(3);
    const transport = fakeAiTransport(() =>
      JSON.stringify({ preferences: ["滴滴出行算交通", " 滴滴出行算交通 "] })
    );
    setAiTransportForTests(transport);

    await expect(runPreferenceLearning({ now: NOW })).resolves.toBe("updated");

    const ledger = await ledgerRow();
    expect(ledger?.aiLearnedPreferences).toBe("- 滴滴出行算交通");
    expect(ledger?.aiLearnedPreferencesUpdatedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await unconsumed()).toEqual([]);
    const request = transport.complete.mock.calls[0]![0];
    expect(request.messages[0]!.content).toContain("快车 0");
    expect(request.messages[0]!.content).toContain("餐饮");
  });

  it("hands the model the current text and the owner's own instructions", async () => {
    const { db } = await createFixture(3);
    await db
      .update(ledgers)
      .set({ aiLearnedPreferences: "- 老规则", aiCustomPrompt: "星巴克算餐饮" });
    const transport = fakeAiTransport(() =>
      JSON.stringify({ preferences: ["- 老规则", "新规则"] })
    );
    setAiTransportForTests(transport);

    await runPreferenceLearning({ now: NOW });

    const message = JSON.parse(String(transport.complete.mock.calls[0]![0].messages[0]!.content));
    expect(message.current_preferences).toBe("- 老规则");
    expect(message.owner_instructions).toBe("星巴克算餐饮");
    expect((await ledgerRow())?.aiLearnedPreferences).toBe("- 老规则\n- 新规则");
  });

  it("shows the corrections it already read as background on the next run", async () => {
    const { db, record } = await createFixture(3);
    setAiTransportForTests(fakeAiTransport(() => JSON.stringify({ preferences: ["a"] })));
    await runPreferenceLearning({ now: NOW });
    await db.insert(aiCorrections).values(
      Array.from({ length: 3 }, (_, index) => ({
        sourceDocumentId: record.sourceDocumentId,
        subjectId: crypto.randomUUID(),
        field: "item_name" as const,
        documentTitle: "滴滴出行",
        itemName: `新 ${index}`,
        beforeValue: `before ${index}`,
        afterValue: `after ${index}`,
        updatedAt: new Date(NOW.getTime() + 1000 + index),
      }))
    );
    const transport = fakeAiTransport(() => JSON.stringify({ preferences: ["b"] }));
    setAiTransportForTests(transport);

    await runPreferenceLearning({ now: new Date(NOW.getTime() + 60_000) });

    const message = JSON.parse(String(transport.complete.mock.calls[0]![0].messages[0]!.content));
    expect(message.new_corrections).toHaveLength(3);
    expect(message.earlier_corrections).toHaveLength(3);
    expect(message.earlier_corrections[0].owner_value).toBe("交通");
  });

  it("writes nothing when the owner edited the text while the model worked", async () => {
    const { db } = await createFixture(3);
    setAiTransportForTests(
      fakeAiTransport(async () => {
        await db.update(ledgers).set({ aiLearnedPreferences: "- 我自己改的" });
        return JSON.stringify({ preferences: ["模型的结果"] });
      })
    );

    await expect(runPreferenceLearning({ now: NOW })).resolves.toBe("stale");

    expect((await ledgerRow())?.aiLearnedPreferences).toBe("- 我自己改的");
    expect(await unconsumed()).toHaveLength(3);
  });

  it("leaves a correction edited during the run unread", async () => {
    const { db } = await createFixture(3);
    setAiTransportForTests(
      fakeAiTransport(async () => {
        await db
          .update(aiCorrections)
          .set({ afterValue: "餐饮", updatedAt: new Date(NOW.getTime() + 60_000) })
          .where(eq(aiCorrections.itemName, "快车 0"));
        return JSON.stringify({ preferences: ["滴滴出行算交通"] });
      })
    );

    await expect(runPreferenceLearning({ now: NOW })).resolves.toBe("updated");

    expect(await unconsumed()).toMatchObject([{ itemName: "快车 0" }]);
  });

  it("does not run while learning is switched off", async () => {
    const { db } = await createFixture(3);
    await db.update(ledgers).set({ aiPreferenceLearningEnabled: false });
    const transport = fakeAiTransport(() => JSON.stringify({ preferences: ["x"] }));
    setAiTransportForTests(transport);

    await expect(runPreferenceLearning({ now: NOW })).resolves.toBe("disabled");

    expect(transport.complete).not.toHaveBeenCalled();
  });

  it("clears the text and the corrections it came from", async () => {
    const { db, record } = await createFixture(3);
    setAiTransportForTests(fakeAiTransport(() => JSON.stringify({ preferences: ["a"] })));
    await runPreferenceLearning({ now: NOW });

    const cleared = await clearLearnedPreferences();

    expect(cleared.settings).toMatchObject({
      aiLearnedPreferences: "",
      aiLearnedPreferencesUpdatedAt: null,
    });
    expect(await db.query.aiCorrections.findMany()).toEqual([]);
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, record.sourceDocumentId),
      })
    ).toMatchObject({ id: record.sourceDocumentId });
  });

  it("lets the owner edit the learned text and the switch like any setting", async () => {
    await createFixture(0);

    const updated = await updateLedgerSettings({
      settings: { aiLearnedPreferences: "- 手改", aiPreferenceLearningEnabled: false },
    });

    expect(updated.settings).toMatchObject({
      aiLearnedPreferences: "- 手改",
      aiPreferenceLearningEnabled: false,
    });
  });
});
