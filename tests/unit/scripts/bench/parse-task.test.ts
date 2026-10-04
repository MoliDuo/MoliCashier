import { describe, expect, it, vi } from "vitest";
import { runBenchmark } from "../../../../scripts/bench/lib/runner";
import type { BenchDocument, ParseExpect } from "../../../../scripts/bench/lib/schema";
import { parseTask } from "../../../../scripts/bench/tasks/parse/task";
import type { AiContextContract } from "@/modules/source-document/domain/parse/contracts";
import { FIXTURE_CATEGORIES, GOLD_LABELS } from "../../../helpers/bench-dataset";

function document(
  overrides: Partial<BenchDocument["ledger"]> & { text?: string } = {}
): BenchDocument {
  const { text = "", ...ledger } = overrides;
  return {
    schemaVersion: 1,
    id: "doc-test",
    title: "Example Cafe",
    text,
    images: [],
    ledger: {
      categories: FIXTURE_CATEGORIES,
      preferredCurrencies: ["CNY"],
      aiLanguage: "en",
      customPrompt: "",
      ...ledger,
    },
  };
}

/** An AI that answers with `body` and records what the parser asked. */
function aiAnswering(body: unknown) {
  const generate = vi.fn<AiContextContract["generate"]>(async () => ({
    content: JSON.stringify(body),
    usage: { promptTokens: 100, completionTokens: 20 },
  }));
  return { generate, ai: { generate } as AiContextContract };
}

async function evaluate(
  benchDocument: BenchDocument,
  expectation: ParseExpect,
  ai: AiContextContract,
  images: { dataUrl: string }[] = []
) {
  const [result] = await runBenchmark({
    task: parseTask,
    cases: [{ document: benchDocument, images, labels: GOLD_LABELS, expect: expectation }],
    repeat: 1,
    concurrency: 1,
    createAi: () => ai,
  });
  const run = result?.runs[0];
  if (run == null) throw new Error("no run recorded");
  return run;
}

const lunchAnswer = {
  outcome: "success",
  invalid_reason: null,
  title: "Example Cafe",
  receipt_count: 1,
  ledger_entries: [
    {
      receipt_index: 0,
      item_name: "Lunch set",
      amount: "45.00",
      currency: "CNY",
      category_index: 1,
      notes: null,
      date_hint: null,
    },
  ],
  order_adjustments: [
    { receipt_index: 0, item_name: "Coupon", amount: "-5.00", currency: "CNY", category_index: 0 },
  ],
  reasoning: "ok",
};

const lunchExpect: ParseExpect = {
  outcome: "success",
  entries: [
    { itemName: "Lunch set", amount: "45.00", currency: "CNY", category: "Food" },
    { itemName: "Coupon", amount: "-5.00", currency: "CNY", category: "Food" },
  ],
};

describe("parse task", () => {
  it("scores what the production pipeline would save, adjustments included", async () => {
    const { ai, generate } = aiAnswering(lunchAnswer);
    const run = await evaluate(document({ text: "lunch 45, coupon 5" }), lunchExpect, ai);

    // The coupon had no category of its own; the pipeline gives it the receipt's single category.
    expect(run.pass).toBe(true);
    expect(run.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]?.[0];
    expect(request?.prompt).toContain("1. Food — Meals and drinks");
    expect(request?.prompt).toContain("lunch 45, coupon 5");
  });

  it("sends the document's images as image parts, and none for a text document", async () => {
    const withImage = aiAnswering(lunchAnswer);
    await evaluate(document(), lunchExpect, withImage.ai, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);
    expect(JSON.stringify(withImage.generate.mock.calls[0]?.[0].messages)).toContain(
      "data:image/png;base64,AAAA"
    );

    const textOnly = aiAnswering(lunchAnswer);
    await evaluate(document({ text: "lunch" }), lunchExpect, textOnly.ai);
    expect(JSON.stringify(textOnly.generate.mock.calls[0]?.[0].messages)).not.toContain(
      "image_url"
    );
  });

  it("passes the ledger's custom prompt and language through", async () => {
    const { ai, generate } = aiAnswering(lunchAnswer);
    await evaluate(
      document({ text: "lunch", customPrompt: "Always mention the branch", aiLanguage: "zh-CN" }),
      lunchExpect,
      ai
    );
    expect(generate.mock.calls[0]?.[0].prompt).toContain("Always mention the branch");
  });

  it("scores an invalid document", async () => {
    const { ai } = aiAnswering({
      outcome: "invalid",
      invalid_reason: "This is a refund note.",
      title: "Refund",
      receipt_count: 0,
      ledger_entries: [],
      order_adjustments: [],
      reasoning: "refund",
    });
    const run = await evaluate(
      document({ text: "refund" }),
      { outcome: "invalid", entries: [] },
      ai
    );
    expect(run.pass).toBe(true);
  });

  it("fails a wrong answer and says how in the notes", async () => {
    const wrong = {
      ...lunchAnswer,
      ledger_entries: [{ ...lunchAnswer.ledger_entries[0], category_index: 2 }],
    };
    const run = await evaluate(document({ text: "lunch" }), lunchExpect, aiAnswering(wrong).ai);
    expect(run.pass).toBe(false);
    expect(run.notes.join("\n")).toContain("total CNY|Transport: expected 0, got 40");
  });

  it("records a model answer the app would reject as a failed run with the app's error code", async () => {
    const { ai } = aiAnswering({ ...lunchAnswer, ledger_entries: [{ amount: 45 }] });
    const run = await evaluate(document({ text: "lunch" }), lunchExpect, ai);
    expect(run.pass).toBe(false);
    expect(run.error?.code).toBe("ai_schema_invalid");
  });

  it("flags an expected category that the document's ledger does not have", () => {
    expect(
      parseTask.check(document(), {
        outcome: "success",
        entries: [{ itemName: "x", amount: "1.00", currency: "CNY", category: "Pets" }],
      })
    ).toEqual(["entries.0.category is not one of the document's categories"]);
    expect(parseTask.check(document(), lunchExpect)).toEqual([]);
  });
});
