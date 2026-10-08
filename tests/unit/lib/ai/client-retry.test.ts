import { OpenAiTransport, type CompleteRequest } from "@/lib/ai/client";
import { runtimeEnv } from "@/lib/env/runtime";
import { vi, describe, beforeEach, afterEach, it, expect } from "vitest";
import { must } from "tests/helpers/must";

const { mockCreate, mockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockOpenAI = vi.fn(function () {
    return {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };
  });

  // Mock APIError class attached to the default export
  class MockAPIError extends Error {
    status: number | undefined;
    constructor(status: number | undefined, message: string) {
      super(message);
      this.status = status;
      this.name = "APIError";
    }
  }

  // Use unknown then intersection for safer casting than any
  (mockOpenAI as unknown as { APIError: typeof MockAPIError }).APIError = MockAPIError;

  return { mockCreate, mockOpenAI };
});

vi.mock("openai", () => {
  return {
    default: mockOpenAI,
  };
});

const baseRequest: CompleteRequest = {
  system: "prompt",
  messages: [],
  maxTokens: 8192,
  temperature: 1,
};

describe("OpenAiTransport Retry Logic", () => {
  let client: OpenAiTransport;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";

    mockCreate.mockReset();
    mockOpenAI.mockClear();

    client = new OpenAiTransport();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks a reasoning model for the effort the caller chose, and for none otherwise", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "Success" } }] });

    await client.complete(baseRequest);
    await client.complete({ ...baseRequest, reasoningEffort: "low" });

    expect(mockCreate.mock.calls[0]![0]).not.toHaveProperty("reasoning_effort");
    expect(mockCreate.mock.calls[1]![0]).toMatchObject({ reasoning_effort: "low" });
  });

  it("should return content on success", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
    });

    const result = await client.complete(baseRequest);
    expect(result.content).toBe("Success");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("omits baseURL from the OpenAI constructor when it is not configured", () => {
    process.env.OPENAI_BASE_URL = "";
    mockOpenAI.mockClear();

    new OpenAiTransport();

    const firstConstructorCall = must(
      mockOpenAI.mock.calls[0] as unknown[] | undefined,
      "OpenAI constructor call"
    );

    const constructorArgs = must(
      firstConstructorCall[0] as Record<string, unknown> | undefined,
      "OpenAI constructor options"
    );
    expect(Object.hasOwn(constructorArgs, "baseURL")).toBe(false);
  });

  it("passes baseURL through when a custom provider URL is configured", () => {
    process.env.OPENAI_BASE_URL = "https://openai-proxy.example/v1";
    mockOpenAI.mockClear();

    new OpenAiTransport();

    const firstConstructorCall = must(
      mockOpenAI.mock.calls[0] as unknown[] | undefined,
      "OpenAI constructor call"
    );

    const constructorArgs = must(
      firstConstructorCall[0] as Record<string, unknown> | undefined,
      "OpenAI constructor options"
    );
    expect(constructorArgs.baseURL).toBe("https://openai-proxy.example/v1");
  });

  it("omits usage when OpenAI does not return token usage", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
    });

    const result = await client.complete(baseRequest);

    expect(Object.hasOwn(result, "usage")).toBe(false);
  });

  it("reads DeepSeek's cache hits and a reasoning model's thinking from the usage", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 300,
        prompt_cache_hit_tokens: 640,
        completion_tokens_details: { reasoning_tokens: 200 },
      },
    });

    const result = await client.complete(baseRequest);

    expect(result.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 300,
      cachedPromptTokens: 640,
      reasoningTokens: 200,
    });
  });

  it("reads OpenAI's cached tokens, and leaves out what the provider does not say", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 300,
        prompt_tokens_details: { cached_tokens: 512 },
      },
    });

    const result = await client.complete(baseRequest);

    expect(result.usage).toEqual({
      promptTokens: 1000,
      completionTokens: 300,
      cachedPromptTokens: 512,
    });
  });

  it("sends the configured model with the caller's output budget", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
    });

    await client.complete({ ...baseRequest, maxTokens: 321, temperature: 0.3 });

    const body = mockCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(runtimeEnv.aiModel).not.toBe("");
    expect(body).toMatchObject({
      model: runtimeEnv.aiModel,
      max_tokens: 321,
      temperature: 0.3,
    });
  });

  it("omits response_format and signal when they are not provided", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "Success" } }],
    });

    await client.complete(baseRequest);

    const request = must(
      mockCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined,
      "completion request"
    );
    const requestOptions = must(
      mockCreate.mock.calls[0]?.[1] as Record<string, unknown> | undefined,
      "completion request options"
    );

    expect(Object.hasOwn(request, "response_format")).toBe(false);
    expect(Object.hasOwn(requestOptions, "signal")).toBe(false);
  });

  it("should retry on retryable error and succeed", async () => {
    // We can use a generic Error here because my code checks `isRetryable || true` which falls back to retry unless it's a specific 4xx
    // But to be precise, let's use a 429 error
    const error = new Error("Rate limit 429");
    mockCreate
      .mockRejectedValueOnce(error) // Fail 1
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Success after retry" } }],
      }); // Success 2

    const result = await client.complete(baseRequest);
    expect(result.content).toBe("Success after retry");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("should exhaust retries and throw error", async () => {
    const error = new Error("Data parse error");
    mockCreate.mockRejectedValue(error);

    await expect(client.complete(baseRequest)).rejects.toThrow("Data parse error");
    // Initial + 2 retries = 3 calls
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("should retry on 5xx errors", async () => {
    const error = new Error("500 Internal Server Error");
    mockCreate.mockRejectedValueOnce(error).mockResolvedValueOnce({
      choices: [{ message: { content: "Recovered" } }],
    });

    const result = await client.complete(baseRequest);
    expect(result.content).toBe("Recovered");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("should NOT retry on 400 Bad Request", async () => {
    const error = new (
      mockOpenAI as unknown as { APIError: new (status: number, message: string) => Error }
    ).APIError(400, "Bad Request");
    mockCreate.mockRejectedValueOnce(error);

    // My client might be using the global mock if not careful,
    // but beforeEach creates a new OpenAiTransport() which should use the mocked 'openai' package.
    await expect(client.complete(baseRequest)).rejects.toThrow("Bad Request");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
