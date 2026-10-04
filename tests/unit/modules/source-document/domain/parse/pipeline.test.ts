import { describe, it, expect, vi } from "vitest";
import type { GenerateStructured } from "@/lib/ai/structured";
import type { ParseSourceDocumentInput } from "@/modules/source-document/domain/parse/contracts";
import {
  runParsePipeline,
  buildParserInput,
} from "@/modules/source-document/domain/parse/pipeline";
import { fakeAiTransport, generateVia, type FakeAiTransport } from "../../../../../helpers/fake-ai";

// Mock DB so pipeline unit tests don't need a real database
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      sourceDocuments: {
        findFirst: vi.fn(async () => null),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  },
}));

const SIMPLE_ENTRY = {
  receipt_index: 0,
  item_name: "Lunch",
  amount: "10",
  currency: "USD",
  category_index: 1,
  notes: null,
};

const SIMPLE_FIRST_PARSE_RESULT = {
  outcome: "success",
  title: "Test Receipt",
  receipt_count: 1,
  receipt_totals: [{ receipt_index: 0, amount: "10", currency: "USD" }],
  ledger_entries: [SIMPLE_ENTRY],
  order_adjustments: [],
  reasoning: "single item",
};

const COMPLEX_ENTRIES = [
  {
    receipt_index: 0,
    item_name: "A",
    amount: "10",
    currency: "USD",
    category_index: 1,
    notes: null,
  },
  {
    receipt_index: 0,
    item_name: "B",
    amount: "20",
    currency: "USD",
    category_index: 1,
    notes: null,
  },
  {
    receipt_index: 0,
    item_name: "C",
    amount: "30",
    currency: "USD",
    category_index: 1,
    notes: null,
  },
  {
    receipt_index: 0,
    item_name: "D",
    amount: "40",
    currency: "USD",
    category_index: 1,
    notes: null,
  },
];

const COMPLEX_FIRST_PARSE_RESULT = {
  ...SIMPLE_FIRST_PARSE_RESULT,
  receipt_totals: [{ receipt_index: 0, amount: "100", currency: "USD" }],
  ledger_entries: COMPLEX_ENTRIES,
};

function createMockAI(
  options: {
    firstParseResult?: object;
    firstParseOutcome?: "success" | "invalid";
  } = {}
): { generate: GenerateStructured; transport: FakeAiTransport } {
  const { firstParseResult = SIMPLE_FIRST_PARSE_RESULT, firstParseOutcome } = options;

  const transport = fakeAiTransport(() =>
    JSON.stringify(
      firstParseOutcome != null
        ? { ...firstParseResult, outcome: firstParseOutcome }
        : firstParseResult
    )
  );

  return { generate: generateVia(transport), transport };
}

type ParseSourceDocumentInputOverrides = {
  [K in keyof ParseSourceDocumentInput]?: ParseSourceDocumentInput[K] | undefined;
};

function createInput(overrides: ParseSourceDocumentInputOverrides = {}): ParseSourceDocumentInput {
  return {
    categories: overrides.categories ?? [{ id: "cat-1", name: "Food", description: null }],
    settings: overrides.settings ?? {},
    ...("text" in overrides
      ? overrides.text !== undefined
        ? { text: overrides.text }
        : {}
      : { text: "Lunch 10 USD" }),
    ...("evidence" in overrides
      ? overrides.evidence !== undefined
        ? { evidence: overrides.evidence }
        : {}
      : { evidence: { images: [{ dataUrl: "data:image/jpeg;base64,FAKE" }] } }),
    ...("aiLanguage" in overrides
      ? overrides.aiLanguage !== undefined
        ? { aiLanguage: overrides.aiLanguage }
        : {}
      : { aiLanguage: "zh-CN" }),
    ...("preferredCurrencies" in overrides
      ? overrides.preferredCurrencies !== undefined
        ? { preferredCurrencies: overrides.preferredCurrencies }
        : {}
      : { preferredCurrencies: ["USD"] }),
  };
}

function buildCtx(generate: GenerateStructured) {
  return {
    signal: new AbortController().signal,
    generate,
  };
}

describe("runParsePipeline — single-pass flow", () => {
  it("uses one AI request for both simple and complex documents", async () => {
    for (const firstParseResult of [SIMPLE_FIRST_PARSE_RESULT, COMPLEX_FIRST_PARSE_RESULT]) {
      const { generate, transport } = createMockAI({ firstParseResult });
      const result = await runParsePipeline(createInput(), buildCtx(generate));

      expect(result.kind).toBe("success");
      expect(transport.complete).toHaveBeenCalledOnce();
    }
  });

  it("provides a nonblank fallback title when an invalid AI result has no usable title", async () => {
    for (const title of [null, undefined, "   "] as const) {
      const { generate } = createMockAI({
        firstParseResult: {
          ...SIMPLE_FIRST_PARSE_RESULT,
          outcome: "invalid",
          ...(title === undefined ? {} : { title }),
          ledger_entries: [],
          receipt_totals: [],
        },
      });

      const result = await runParsePipeline(
        createInput({ text: "今天天气很好出去散步了" }),
        buildCtx(generate)
      );

      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") expect(result.title.trim()).not.toBe("");
    }
  });

  it("invalid outcome returns the AI reason and the AI-declared diagnostic", async () => {
    const { generate } = createMockAI({
      firstParseResult: {
        ...SIMPLE_FIRST_PARSE_RESULT,
        outcome: "invalid",
        invalid_reason: "Image too blurry",
        ledger_entries: [],
        receipt_totals: [],
      },
    });
    const result = await runParsePipeline(createInput(), buildCtx(generate));

    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.reason).toBe("Image too blurry");
      expect(result.diagnostic).toBe("ai_declared_invalid");
    }
  });

  it("invalid outcome without a reason stays reason-less instead of inventing text", async () => {
    const { generate } = createMockAI({
      firstParseResult: {
        ...SIMPLE_FIRST_PARSE_RESULT,
        outcome: "invalid",
        invalid_reason: "   ",
        ledger_entries: [],
        receipt_totals: [],
      },
    });
    const result = await runParsePipeline(createInput(), buildCtx(generate));

    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.reason).toBeUndefined();
      expect(result.diagnostic).toBe("ai_declared_invalid");
    }
  });

  it("flags a self-detected non-positive entry with its own diagnostic", async () => {
    const { generate } = createMockAI({
      firstParseResult: {
        ...SIMPLE_FIRST_PARSE_RESULT,
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Discount",
            amount: "0",
            currency: "CNY",
            category_index: 0,
            notes: null,
          },
        ],
        receipt_totals: [],
      },
    });
    const result = await runParsePipeline(createInput(), buildCtx(generate));

    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.diagnostic).toBe("non_positive_entry");
    }
  });

  it("text-only input sends no image parts", async () => {
    const { generate, transport } = createMockAI({ firstParseResult: SIMPLE_FIRST_PARSE_RESULT });
    await runParsePipeline(
      createInput({ evidence: undefined, text: "Lunch 10 USD" }),
      buildCtx(generate)
    );

    expect(transport.complete).toHaveBeenCalled();
    for (const [options] of transport.complete.mock.calls) {
      expect(
        options.messages.every(
          (message) =>
            typeof message.content === "string" ||
            message.content.every((part) => part.type === "text")
        )
      ).toBe(true);
    }
  });

  it("success result includes ledgerEntries from parse output", async () => {
    const { generate } = createMockAI({ firstParseResult: SIMPLE_FIRST_PARSE_RESULT });
    const result = await runParsePipeline(createInput(), buildCtx(generate));

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.ledgerEntries).toHaveLength(1);
      expect(result.ledgerEntries[0]?.amount).toBe("10.00");
    }
  });

  it("accepts mixed currencies without totals and preserves signed adjustments", async () => {
    const { generate } = createMockAI({
      firstParseResult: {
        ...SIMPLE_FIRST_PARSE_RESULT,
        receipt_totals: [],
        ledger_entries: [SIMPLE_ENTRY, { ...SIMPLE_ENTRY, currency: "MYR", amount: "30" }],
        order_adjustments: [
          {
            receipt_index: 0,
            item_name: "Discount",
            amount: "-2",
            currency: "MYR",
            category_index: 0,
          },
        ],
      },
    });
    const result = await runParsePipeline(createInput(), buildCtx(generate));
    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.ledgerEntries.map((e) => [e.amount, e.currency])).toEqual([
        ["10.00", "USD"],
        ["30.00", "MYR"],
        ["-2.00", "MYR"],
      ]);
    }
  });
  it.each(["1", "1000"])(
    "ignores legacy total %s without synthesizing balancing rows",
    async (amount) => {
      const { generate } = createMockAI({
        firstParseResult: {
          ...SIMPLE_FIRST_PARSE_RESULT,
          receipt_totals: [{ receipt_index: 0, amount, currency: "USD" }],
        },
      });
      const result = await runParsePipeline(
        createInput({ aiLanguage: undefined }),
        buildCtx(generate)
      );
      expect(result.kind).toBe("success");
      if (result.kind === "success")
        expect(result.ledgerEntries).toEqual([
          expect.objectContaining({ amount: "10.00", isAdjustment: false }),
        ]);
    }
  );

  it("cancellation returns cancelled result", async () => {
    const controller = new AbortController();
    // Abort during the first AI call but still return a valid result, so the
    // pipeline reaches the post-parse cancellation check and reports cancelled
    // instead of treating the aborted request as a parse failure.
    const abortingTransport = fakeAiTransport(() => {
      controller.abort();
      return JSON.stringify(SIMPLE_FIRST_PARSE_RESULT);
    });
    const ctx = {
      signal: controller.signal,
      generate: generateVia(abortingTransport),
    };

    const result = await runParsePipeline(createInput(), ctx);
    expect(result.kind).toBe("cancelled");
  });
});

describe("buildParserInput", () => {
  it("includes categories, text, evidence, aiLanguage, currencies, and custom prompt", () => {
    const input = createInput({
      text: "user text",
      evidence: { images: [{ dataUrl: "data:image/jpeg;base64,FAKE" }] },
      aiLanguage: "en-US",
      preferredCurrencies: ["USD"],
      settings: { aiCustomPrompt: "Prefer food-related detail" },
      categories: [{ id: "cat-1", name: "Food", description: null }],
    });

    const firstParseInput = buildParserInput(input);

    expect(firstParseInput.text).toBe("user text");
    expect(firstParseInput.evidence).toEqual({
      images: [{ dataUrl: "data:image/jpeg;base64,FAKE" }],
    });
    expect(firstParseInput.aiLanguage).toBe("en-US");
    expect(firstParseInput.preferredCurrencies).toEqual(["USD"]);
    expect(firstParseInput.aiCustomPrompt).toBe("Prefer food-related detail");
    expect(firstParseInput.originalCategories).toEqual([{ name: "Food", description: null }]);
  });
});
