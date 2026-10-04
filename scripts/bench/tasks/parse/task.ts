/**
 * The parse task: a document goes through the production parse pipeline —
 * `runParsePipeline`, the same call the app's attempt processor makes — and the
 * ledger entries it would save are compared with the annotation.
 */
import {
  runParsePipeline,
  type StageContext,
} from "@/modules/source-document/domain/parse/pipeline";
import type { ParseSourceDocumentInput } from "@/modules/source-document/domain/parse/contracts";
import type { BenchDocument } from "../../lib/schema";
import { parseExpectSchema, type ParseExpect } from "../../lib/schema";
import { defineTask } from "../types";
import { scoreParse, type ParsedOutput } from "./score";

function buildInput(
  document: BenchDocument,
  images: readonly { dataUrl: string }[]
): ParseSourceDocumentInput {
  const { ledger } = document;
  return {
    categories: ledger.categories.map((category, index) => ({
      id: String(index + 1),
      name: category.name,
      description: category.description,
    })),
    aiLanguage: ledger.aiLanguage,
    preferredCurrencies: ledger.preferredCurrencies,
    settings: ledger.customPrompt === "" ? {} : { aiCustomPrompt: ledger.customPrompt },
    ...(document.text === "" ? {} : { text: document.text }),
    ...(images.length === 0 ? {} : { evidence: { images } }),
  };
}

export const parseTask = defineTask<ParseExpect, ParsedOutput>({
  name: "parse",
  expectSchema: parseExpectSchema,

  check(document, expect) {
    const names = new Set(document.ledger.categories.map((category) => category.name));
    return expect.entries.flatMap((entry, index) =>
      entry.category == null || names.has(entry.category)
        ? []
        : [`entries.${index}.category is not one of the document's categories`]
    );
  },

  async run({ document, images, generate, signal }) {
    const context: StageContext = { generate, signal };
    const result = await runParsePipeline(buildInput(document, images), context);
    if (result.kind === "cancelled") throw new Error("parse pipeline was cancelled");
    if (result.kind === "invalid") return { outcome: "invalid", entries: [] };
    return {
      outcome: "success",
      entries: result.ledgerEntries.map((entry) => ({
        amount: entry.amount,
        currency: entry.currency,
        category:
          entry.categoryIndex > 0
            ? (document.ledger.categories[entry.categoryIndex - 1]?.name ?? null)
            : null,
      })),
    };
  },

  score: ({ expect, output }) => scoreParse(expect, output),
});
