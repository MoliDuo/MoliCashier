import "server-only";
import type { z } from "zod";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import type { AiContentPart } from "@/lib/ai/client";
import { evidenceImageContent } from "@/lib/ai/evidence-images";
import type { EvidenceImage } from "@/lib/ai/types";
import type { GenerateStructured } from "@/lib/ai/structured";
import {
  ProcessingCancelledError,
  ProcessingFailure,
  throwIfProcessingCancelled,
  type ParseSourceDocumentInput,
  type ParsePipelineResult,
} from "@/modules/source-document/domain/parse/contracts";
import {
  buildParserInput,
  buildParserPrompt,
  documentTextSection,
  type ParserInput,
} from "@/modules/source-document/domain/parse/parser-prompt";
import {
  normalizeResult,
  parserOutputSchema,
  type NormalizedParseOutput,
} from "@/modules/source-document/domain/parse/parser-schema";
import { resolveParseOutcome } from "@/modules/source-document/domain/parse/result-mapper";
import { AI_ATTEMPT_DEADLINE_MS, PARSE_AI_MAX_TOKENS, PARSE_AI_TIMEOUT_MS } from "@/config/tuning";

/**
 * The provider's default, kept on purpose rather than forced: the model accepts lower values (the
 * category step uses 0.1, preference learning and forecast judgment 0.2), but parsing moves to a
 * lower one only once `npm run bench:prompt -- --task parse` shows it is no less accurate than 1.
 * That comparison has not been run yet; change this value only together with its result.
 */
const PARSER_TEMPERATURE = 1;

export interface StageContext {
  signal: AbortSignal;
  generate: GenerateStructured;
}

function buildMessageContent(
  text: string | undefined,
  images: readonly EvidenceImage[] | undefined
): AiContentPart[] {
  return [
    { type: "text", text: "Please parse this source document." },
    ...(text != null && text !== ""
      ? [{ type: "text" as const, text: documentTextSection(text) }]
      : []),
    ...evidenceImageContent(images ?? []),
  ];
}

/** One parse call: the prompt, the document as the user message, the reply normalized. */
export async function executeParser(
  input: ParserInput,
  generate: GenerateStructured,
  signal?: AbortSignal
): Promise<NormalizedParseOutput> {
  const aiLanguage = input.aiLanguage ?? "zh-CN";
  const images = input.evidence?.images;
  const hasImages = (images?.length ?? 0) > 0;

  const prompt = buildParserPrompt(input, aiLanguage);

  logger.debug({ hasImages }, "parser: calling AI");

  let parsed: z.infer<typeof parserOutputSchema>;
  try {
    parsed = await generate({
      task: "parse",
      schema: parserOutputSchema,
      system: prompt,
      messages: [{ role: "user", content: buildMessageContent(input.text, images) }],
      maxTokens: PARSE_AI_MAX_TOKENS,
      timeoutMs: PARSE_AI_TIMEOUT_MS,
      temperature: PARSER_TEMPERATURE,
      ...(signal == null ? {} : { signal }),
    });
  } catch (error) {
    if (signal?.aborted) throw new ProcessingCancelledError();
    if (error instanceof ProcessingFailure) throw error;
    if (error instanceof AppError && error.code === "ai_schema_invalid") {
      throw new ProcessingFailure("ai_schema_invalid", "Parser AI response was invalid", {
        cause: error,
      });
    }
    throw new ProcessingFailure("ai_provider_unavailable", "Parser AI request failed", {
      cause: error,
    });
  }

  const result = normalizeResult(parsed, aiLanguage);
  logger.debug(
    { outcome: result.outcome, entries: result.ledger_entries.length },
    "parser: complete"
  );
  return result;
}

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

    const result = await executeParser(buildParserInput(input), ctx.generate, ctx.signal);

    throwIfProcessingCancelled(ctx.signal);

    return resolveParseOutcome(result);
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
