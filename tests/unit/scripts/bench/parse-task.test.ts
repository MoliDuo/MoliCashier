import { describe, expect, it } from "vitest";
import { runBenchmark } from "../../../../scripts/bench/lib/runner";
import type { BenchDocument, ParseExpect } from "../../../../scripts/bench/lib/schema";
import { parseTask } from "../../../../scripts/bench/tasks/parse/task";
import { fakeAiTransport, generateVia } from "../../../helpers/fake-ai";
import type { GenerateStructured } from "@/lib/ai/structured";
import type { EvidenceImage } from "@/lib/ai/types";
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

/** A model that answers with `body` and records what the parser asked. */
function aiAnswering(body: unknown) {
  const transport = fakeAiTransport(() => ({
    content: JSON.stringify(body),
    usage: { promptTokens: 100, completionTokens: 20 },
  }));
  return { transport, generate: generateVia(transport) };
}

async function evaluate(
  benchDocument: BenchDocument,
  expectation: ParseExpect,
  generate: GenerateStructured,
  images: EvidenceImage[] = []
) {
  const [result] = await runBenchmark({
    task: parseTask,
    cases: [{ document: benchDocument, images, labels: GOLD_LABELS, expect: expectation }],
    repeat: 1,
    concurrency: 1,
    createGenerate: () => generate,
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
    const { generate, transport } = aiAnswering(lunchAnswer);
    const run = await evaluate(document({ text: "lunch 45, coupon 5" }), lunchExpect, generate);

    // The coupon had no category of its own; the pipeline gives it the receipt's single category.
    expect(run.pass).toBe(true);
    expect(run.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(transport.complete).toHaveBeenCalledTimes(1);
    const request = transport.complete.mock.calls[0]?.[0];
    expect(request?.system).toContain("1. Food — Meals and drinks");
    // The document's own text travels in the user message, fenced off as data.
    expect(JSON.stringify(request?.messages)).toContain("lunch 45, coupon 5");
  });

  it("sends the document's images as image parts, and none for a text document", async () => {
    const withImage = aiAnswering(lunchAnswer);
    await evaluate(document(), lunchExpect, withImage.generate, [
      { dataUrl: "data:image/png;base64,AAAA" },
    ]);
    expect(JSON.stringify(withImage.transport.complete.mock.calls[0]?.[0].messages)).toContain(
      "data:image/png;base64,AAAA"
    );

    const textOnly = aiAnswering(lunchAnswer);
    await evaluate(document({ text: "lunch" }), lunchExpect, textOnly.generate);
    expect(JSON.stringify(textOnly.transport.complete.mock.calls[0]?.[0].messages)).not.toContain(
      "image_url"
    );
  });

  it("passes the ledger's custom prompt and language through", async () => {
    const { generate, transport } = aiAnswering(lunchAnswer);
    await evaluate(
      document({ text: "lunch", customPrompt: "Always mention the branch", aiLanguage: "zh-CN" }),
      lunchExpect,
      generate
    );
    expect(transport.complete.mock.calls[0]?.[0].system).toContain("Always mention the branch");
  });

  it("scores an invalid document", async () => {
    const { generate } = aiAnswering({
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
      generate
    );
    expect(run.pass).toBe(true);
  });

  it("fails a wrong answer and says how in the notes", async () => {
    const wrong = {
      ...lunchAnswer,
      ledger_entries: [{ ...lunchAnswer.ledger_entries[0], category_index: 2 }],
    };
    const run = await evaluate(
      document({ text: "lunch" }),
      lunchExpect,
      aiAnswering(wrong).generate
    );
    expect(run.pass).toBe(false);
    expect(run.notes.join("\n")).toContain("total CNY|Transport: expected 0, got 40");
  });

  it("records a model answer the app would reject as a failed run with the app's error code", async () => {
    const { generate, transport } = aiAnswering({
      ...lunchAnswer,
      ledger_entries: [{ amount: 45 }],
    });
    const run = await evaluate(document({ text: "lunch" }), lunchExpect, generate);
    expect(run.pass).toBe(false);
    expect(run.error?.code).toBe("ai_schema_invalid");
    // The reply is asked for again once before the run gives up, and both calls are metered.
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(run.usage).toEqual({ promptTokens: 200, completionTokens: 40 });
    // The reply is asked for again once before the run gives up, and both calls are metered.
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(run.usage).toEqual({ promptTokens: 200, completionTokens: 40 });
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
