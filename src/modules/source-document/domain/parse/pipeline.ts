import {
  ProcessingCancelledError,
  ProcessingFailure,
  throwIfProcessingCancelled,
  type ParseSourceDocumentInput,
  type ParsePipelineResult,
} from "./contracts";
export type { ParsePipelineResult } from "./contracts";
import type { GenerateStructured } from "@/lib/ai/structured";
import { executeParser } from "./parser";
import type { ParserInput } from "./parser";
import { convertToParsedEntries } from "./result-mapper";
import type { NormalizedParseOutput } from "./parser-schema";
import { normalizeFailureReason } from "@/modules/source-document/failure-reason-policy";
import { AI_ATTEMPT_DEADLINE_MS } from "@/config/tuning";

// ===== Context =====

export interface StageContext {
  signal: AbortSignal;
  generate: GenerateStructured;
}

// ===== Result contract =====

// ===== Input mapping =====

export function buildParserInput(input: ParseSourceDocumentInput): ParserInput {
  return {
    originalCategories: input.categories.map((c) => ({
      name: c.name,
      description: c.description ?? null,
    })),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.aiLanguage !== undefined ? { aiLanguage: input.aiLanguage } : {}),
    ...(input.preferredCurrencies !== undefined
      ? { preferredCurrencies: input.preferredCurrencies }
      : {}),
    ...(input.recentEntries !== undefined ? { recentEntries: input.recentEntries } : {}),
    ...(input.settings.aiCustomPrompt !== undefined
      ? { aiCustomPrompt: input.settings.aiCustomPrompt }
      : {}),
    ...(input.settings.aiLearnedPreferences !== undefined
      ? { aiLearnedPreferences: input.settings.aiLearnedPreferences }
      : {}),
  };
}

// ===== Outcome helpers =====

function resolveSuccess(
  result: NormalizedParseOutput
): Extract<ParsePipelineResult, { kind: "success" }> {
  return {
    kind: "success",
    title: result.title,
    ledgerEntries: convertToParsedEntries({
      ledgerEntries: result.ledger_entries,
      orderAdjustments: result.order_adjustments,
    }),
    dateHints: [
      ...result.ledger_entries.map((entry) => entry.date_hint ?? null),
      ...result.order_adjustments.map(() => null),
    ],
  };
}

function resolveOutcome(
  result: NormalizedParseOutput
): ParsePipelineResult | { kind: "continue"; result: NormalizedParseOutput } {
  if (result.outcome === "invalid") {
    const reason = normalizeFailureReason(result.invalid_reason);
    return {
      kind: "invalid",
      title: result.title,
      diagnostic: result.internal_diagnostic ?? "ai_declared_invalid",
      ...(reason == null ? {} : { reason }),
    };
  }
  return { kind: "continue", result };
}

// ===== Pipeline =====

/**
 * Parses one document under the caller's signal, without a deadline of its own; the caller runs it
 * inside `withParseDeadline`, together with whatever it loads for the parse.
 */
export async function executeParsePipeline(
  input: ParseSourceDocumentInput,
  ctx: StageContext
): Promise<ParsePipelineResult> {
  try {
    throwIfProcessingCancelled(ctx.signal);

    const parserInput = buildParserInput(input);
    const result = await executeParser(parserInput, ctx.generate, ctx.signal);

    throwIfProcessingCancelled(ctx.signal);

    const decision = resolveOutcome(result);
    if (decision.kind !== "continue") return decision;

    return resolveSuccess(decision.result);
  } catch (error) {
    if (error instanceof ProcessingCancelledError) {
      return { kind: "cancelled" };
    }
    throw error;
  }
}

/**
 * Runs `work` under the whole-parse deadline: past `AI_ATTEMPT_DEADLINE_MS` the signal handed to
 * it aborts and the call fails as `processing_timeout`, whatever the work was waiting on.
 */
export async function withParseDeadline<T>(
  signal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadlineController = new AbortController();
  const deadlineSignal = AbortSignal.any([signal, deadlineController.signal]);
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      deadlineController.abort();
      reject(
        new ProcessingFailure(
          "processing_timeout",
          `Source document parsing exceeded ${AI_ATTEMPT_DEADLINE_MS}ms deadline`
        )
      );
    }, AI_ATTEMPT_DEADLINE_MS);
    timeout.unref();
  });

  try {
    return await Promise.race([work(deadlineSignal), deadline]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

export function runParsePipeline(
  input: ParseSourceDocumentInput,
  ctx: StageContext
): Promise<ParsePipelineResult> {
  return withParseDeadline(ctx.signal, (signal) => executeParsePipeline(input, { ...ctx, signal }));
}
