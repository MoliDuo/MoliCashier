import "server-only";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import OpenAI, { type APIError } from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runtimeEnv } from "@/lib/env/runtime";
import { AI_MAX_ATTEMPTS, AI_REQUEST_TIMEOUT_MS, AI_RETRY_DELAY_MS } from "@/config/tuning";

export type AiContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface AiMessage {
  role: "user" | "assistant";
  content: string | AiContentPart[];
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  /** Of the prompt, what the provider served from its cache, when it says. */
  cachedPromptTokens?: number;
  /** Of the completion, what a reasoning model spent thinking, when it says. */
  reasoningTokens?: number;
}

/** What OpenAI-compatible providers add to `usage`: DeepSeek its cache hits, OpenAI its details. */
interface ProviderUsage {
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

export interface CompleteRequest {
  system: string;
  messages: readonly AiMessage[];
  /** Every call site picks its own output budget. */
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  /** Defaults to `AI_MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /** Defaults to `AI_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** How hard a reasoning model thinks before it answers; omitted, the provider decides. */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface AiCompletion {
  content: string;
  usage?: AiUsage;
  /**
   * Why the model stopped, when the provider says: "length" means the reply was cut off at the
   * output budget, so whatever it holds is incomplete.
   */
  finishReason?: string;
}

/** The one place a request leaves for the configured model. */
export interface AiTransport {
  complete(request: CompleteRequest): Promise<AiCompletion>;
}

function toChatMessage(message: AiMessage): ChatCompletionMessageParam {
  return {
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) =>
            part.type === "text"
              ? { type: "text" as const, text: part.text }
              : { type: "image_url" as const, image_url: { url: part.image_url.url } }
          ),
  } as ChatCompletionMessageParam;
}

function isSdkError<T extends Error>(
  error: unknown,
  constructor: (abstract new (...args: never[]) => T) | undefined
): error is T {
  return typeof constructor === "function" && error instanceof constructor;
}

/** The most a cooldown is spread by, so the requests it held back do not all go at once. */
const COOLDOWN_JITTER_MAX_MS = 2_000;

/** A random spread for a wait of `waitMs`: up to a quarter of it, and never more than two seconds. */
function cooldownJitterMs(waitMs: number): number {
  return Math.random() * Math.min(COOLDOWN_JITTER_MAX_MS, waitMs / 4);
}

export class OpenAiTransport implements AiTransport {
  private client: OpenAI;
  private cooldownUntil = 0;

  /**
   * Sends once any provider cooldown is over. Requests run side by side; a 429 with Retry-After holds
   * back every request sent after it, so running in parallel does not keep hitting the limit. Each
   * request that waited adds its own random spread, so they do not all hit the provider again at
   * the same instant.
   */
  private async afterCooldown<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    for (;;) {
      if (signal?.aborted) throw new AppError("Request was aborted", "REQUEST_ABORTED");
      const waitMs = this.cooldownUntil - Date.now();
      if (waitMs <= 0) return await run();
      await delay(waitMs + cooldownJitterMs(waitMs), undefined, { signal }).catch(() => undefined);
    }
  }

  private retryAfterMs(error: unknown): number {
    if (!isSdkError(error, OpenAI.APIError) || error.status !== 429) return 0;
    const value = (error as APIError).headers?.get("retry-after");
    if (value == null) return 10_000;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(ms) ? Math.max(0, ms) : 10_000;
  }

  constructor() {
    const apiKey = runtimeEnv.openaiApiKey;
    const baseURL = runtimeEnv.hasOpenaiBaseUrl ? runtimeEnv.openaiBaseUrl : undefined;

    if (apiKey == null || apiKey === "") {
      throw new AppError("OPENAI_API_KEY is not set", "OPENAI_API_KEY_MISSING");
    }

    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: AI_REQUEST_TIMEOUT_MS,
      dangerouslyAllowBrowser: process.env.NODE_ENV === "test", // Only enable in test environment
      ...(baseURL != null && baseURL !== "" ? { baseURL } : {}),
    });
  }

  async complete(request: CompleteRequest): Promise<AiCompletion> {
    const { system: systemPrompt, signal } = request;
    const model = runtimeEnv.aiModel;
    if (model === "") {
      throw new AppError("AI model configuration is required", "AI_MODEL_CONFIG_REQUIRED");
    }
    const messages = request.messages.map(toChatMessage);
    const maxAttempts = request.maxAttempts ?? AI_MAX_ATTEMPTS;
    const timeoutMs = request.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
    const baseDelay = AI_RETRY_DELAY_MS;
    const correlationId = crypto.randomUUID();
    const serializedMessages = JSON.stringify(messages);
    const inputHash = crypto
      .createHash("sha256")
      .update(systemPrompt)
      .update(serializedMessages)
      .digest("hex")
      .slice(0, 12);
    const startedAt = Date.now();

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if aborted before each attempt
      if (signal?.aborted) {
        throw new AppError("Request was aborted", "REQUEST_ABORTED");
      }

      try {
        const requestMessages: ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...messages,
        ];
        const body: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: requestMessages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          ...(request.reasoningEffort === undefined
            ? {}
            : { reasoning_effort: request.reasoningEffort }),
        };
        const requestOptions = { ...(signal !== undefined ? { signal } : {}), timeout: timeoutMs };
        const response = await this.afterCooldown(signal, async () => {
          try {
            return await this.client.chat.completions.create(body, requestOptions);
          } catch (error) {
            const retryAfterMs = this.retryAfterMs(error);
            this.cooldownUntil = Math.max(
              this.cooldownUntil,
              Date.now() + retryAfterMs + cooldownJitterMs(retryAfterMs)
            );
            throw error;
          }
        });

        if (
          response.choices == null ||
          !Array.isArray(response.choices) ||
          response.choices.length === 0
        ) {
          logger.error(
            {
              correlationId,
              inputHash,
              inputLength: systemPrompt.length + serializedMessages.length,
              model,
              durationMs: Date.now() - startedAt,
              errorCode: "OPENAI_INVALID_RESPONSE",
            },
            "OpenAI response missing choices"
          );
          throw new AppError("Invalid OpenAI response: missing choices", "OPENAI_INVALID_RESPONSE");
        }

        const choice = response.choices[0];
        const content = choice?.message?.content ?? "";

        // Handle empty response with specific finish reasons
        if (content === "" && choice?.finish_reason != null) {
          if (choice.finish_reason === "content_filter") {
            throw new AppError(
              "Content was filtered by OpenAI safety systems. The image may contain content that cannot be processed.",
              "OPENAI_CONTENT_FILTERED"
            );
          } else if (choice.finish_reason === "length") {
            throw new AppError(
              "Input too large: The images consume too many tokens, leaving no space for output. Try with fewer or smaller images.",
              "OPENAI_INPUT_TOO_LARGE"
            );
          }
        }

        // A reply cut off at the output budget is passed on as such; the structured layer refuses it.
        const finishReason = choice?.finish_reason ?? undefined;
        const finish = finishReason == null ? {} : { finishReason };

        // Extract token usage from OpenAI response
        if (response.usage == null) {
          return { content, ...finish };
        }

        const extra = response.usage as ProviderUsage;
        const cachedPromptTokens =
          extra.prompt_cache_hit_tokens ?? extra.prompt_tokens_details?.cached_tokens;
        const reasoningTokens = extra.completion_tokens_details?.reasoning_tokens;
        return {
          content,
          usage: {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            ...(cachedPromptTokens == null ? {} : { cachedPromptTokens }),
            ...(reasoningTokens == null ? {} : { reasoningTokens }),
          },
          ...finish,
        };
      } catch (error) {
        lastError = error;

        // Don't retry if aborted
        if (signal?.aborted) {
          break;
        }

        // Determine if the error is retryable
        let isRetryable = !(
          error instanceof AppError &&
          (error.code === "OPENAI_CONTENT_FILTERED" || error.code === "OPENAI_INPUT_TOO_LARGE")
        );

        // If it's an OpenAI APIError, check the status code
        if (isSdkError(error, OpenAI.APIError) && error.status != null) {
          // 4xx errors are generally NOT retryable, except for 429 (Rate Limit)
          if (error.status >= 400 && error.status < 500 && error.status !== 429) {
            isRetryable = false;
          }
        }

        if (attempt + 1 < maxAttempts && isRetryable) {
          const delay = Math.random() * Math.min(5000, baseDelay * Math.pow(2, attempt));
          logger.warn(
            {
              correlationId,
              inputHash,
              model,
              durationMs: Date.now() - startedAt,
              errorCode: isSdkError(error, OpenAI.APIError)
                ? `OPENAI_${error.status ?? "API_ERROR"}`
                : "OPENAI_REQUEST_FAILED",
              attempt: attempt + 1,
              maxAttempts,
              delayMs: Math.round(delay),
            },
            "OpenAI request failed, retrying"
          );
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal?.removeEventListener("abort", abort);
              resolve();
            }, delay);
            const abort = () => {
              clearTimeout(timer);
              reject(new AppError("Request was aborted", "REQUEST_ABORTED"));
            };
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
          });
          continue;
        }

        // If we're out of retries or it's not retryable, break loop
        break;
      }
    }

    // Classify exhausted retries into typed application errors so callers can
    // branch on stable codes instead of provider-specific error shapes or
    // message text. Non-retryable 4xx errors are rethrown unchanged.
    if (isSdkError(lastError, OpenAI.APIError)) {
      if (lastError.status === 429) {
        throw new AppError("AI provider rate limited after retries", "ai_rate_limited", 503, {
          retryAfterMs: Math.max(0, this.cooldownUntil - Date.now()),
        });
      }
      if (lastError.status != null && lastError.status >= 500) {
        throw new AppError("AI provider unavailable after retries", "ai_provider_unavailable", 503);
      }
      if (lastError.status === 401 || lastError.status === 403 || lastError.status === 404) {
        throw new AppError("AI provider configuration is invalid", "ai_configuration_invalid", 500);
      }
    }

    if (isSdkError(lastError, OpenAI.APIConnectionTimeoutError)) {
      throw new AppError("AI request timed out", "ai_timeout", 504);
    }
    // The provider could not be reached at all: refused, reset or a failed DNS lookup.
    if (isSdkError(lastError, OpenAI.APIConnectionError)) {
      throw new AppError("AI provider could not be reached", "ai_provider_unavailable", 503);
    }

    throw lastError;
  }
}

// Singleton instance
let transport: AiTransport | null = null;

export function getAiTransport(): AiTransport {
  transport ??= new OpenAiTransport();
  return transport;
}

/** Tests install a scripted transport here; `null` restores the real one. */
export function setAiTransportForTests(replacement: AiTransport | null): void {
  transport = replacement;
}
