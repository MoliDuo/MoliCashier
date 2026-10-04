import "server-only";
import crypto from "node:crypto";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getAiTransport, type AiMessage, type AiTransport, type AiUsage } from "./client";
import { buildRepairPrompt, extractJson } from "./json";

export interface StructuredRequest<T> {
  /** Labels the log line only. */
  task: string;
  schema: z.ZodType<T>;
  system: string;
  messages: readonly AiMessage[];
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  timeoutMs?: number;
  /** One repair round when the reply is not valid JSON or fails the schema. Defaults to true. */
  repair?: boolean;
  /** Called once with the tokens the call spent, repair included, when the provider reported any. */
  onUsage?: (usage: AiUsage) => void;
}

/** What callers depend on, so a stage can be handed one with its signal already bound. */
export type GenerateStructured = <T>(request: StructuredRequest<T>) => Promise<T>;

type Attempt<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function validate<T>(schema: z.ZodType<T>, content: string): Attempt<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(content));
  } catch {
    return { ok: false, problems: ["The reply is not valid JSON."] };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`
    ),
  };
}

function addUsage(total: AiUsage | undefined, next: AiUsage | undefined): AiUsage | undefined {
  if (next == null) return total;
  if (total == null) return { ...next };
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
  };
}

/**
 * Asks the model for one JSON value and returns it validated against `schema`.
 * Every AI call that wants structured output goes through here, so they share
 * one parse, one repair round, one error code and one log line.
 */
export async function generateStructured<T>(
  request: StructuredRequest<T>,
  transport: AiTransport = getAiTransport()
): Promise<T> {
  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  const { task, schema, repair = true, onUsage, ...rest } = request;
  const common = {
    maxTokens: rest.maxTokens,
    temperature: rest.temperature,
    ...(rest.signal === undefined ? {} : { signal: rest.signal }),
    ...(rest.maxAttempts === undefined ? {} : { maxAttempts: rest.maxAttempts }),
    ...(rest.timeoutMs === undefined ? {} : { timeoutMs: rest.timeoutMs }),
  };

  const first = await transport.complete({
    system: rest.system,
    messages: rest.messages,
    ...common,
  });
  let usage = first.usage;
  let attempt = validate(schema, first.content);
  let repaired = false;

  if (!attempt.ok && repair) {
    logger.warn(
      { correlationId, task, errorCode: "ai_schema_invalid", contentLength: first.content.length },
      "AI reply failed validation, attempting repair"
    );
    repaired = true;
    const fixed = await transport.complete({
      system: buildRepairPrompt(first.content, attempt.problems),
      messages: [{ role: "user", content: "Please fix the JSON." }],
      ...common,
    });
    usage = addUsage(usage, fixed.usage);
    attempt = validate(schema, fixed.content);
  }

  if (usage != null) onUsage?.(usage);
  logger.debug(
    {
      correlationId,
      task,
      durationMs: Date.now() - startedAt,
      repaired,
      ok: attempt.ok,
      ...(usage == null ? {} : { usage }),
    },
    "AI structured call finished"
  );

  if (!attempt.ok) {
    throw new AppError("AI response was invalid", "ai_schema_invalid", 502, {
      task,
      repaired,
      problemCount: attempt.problems.length,
    });
  }
  return attempt.value;
}
