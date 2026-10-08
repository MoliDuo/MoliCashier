import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("ai client", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = originalEnv ?? "test";
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("should allow client creation in test environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "test";
    const { getAiTransport, setAiTransportForTests } = await import("@/lib/ai/client");
    setAiTransportForTests(null);
    // Should not throw in test environment
    expect(() => getAiTransport()).not.toThrow();
  });

  it("should block client creation in production environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { getAiTransport, setAiTransportForTests } = await import("@/lib/ai/client");
    setAiTransportForTests(null);
    // Should throw error about browser environment
    expect(() => getAiTransport()).toThrow("browser");
  });

  it("should block client creation in development environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const { getAiTransport, setAiTransportForTests } = await import("@/lib/ai/client");
    setAiTransportForTests(null);
    // Should throw error about browser environment
    expect(() => getAiTransport()).toThrow("browser");
  });

  describe("error classification after retry exhaustion", () => {
    beforeEach(() => {
      (process.env as Record<string, string>).NODE_ENV = "test";
    });

    const loadClient = async () => {
      const { getAiTransport, setAiTransportForTests } = await import("@/lib/ai/client");
      setAiTransportForTests(null);
      return getAiTransport();
    };

    const base = { maxTokens: 8192, temperature: 1 } as const;

    const stubSdkCreate = (client: unknown, error: unknown) => {
      const sdkClient = client as unknown as {
        client: { chat: { completions: { create: unknown } } };
      };
      sdkClient.client.chat.completions.create = vi.fn().mockRejectedValue(error);
    };

    it.each([
      ["content_filter", "OPENAI_CONTENT_FILTERED"],
      ["length", "OPENAI_INPUT_TOO_LARGE"],
    ])("does not retry deterministic %s responses", async (reason, code) => {
      const client = await loadClient();
      const create = vi.fn().mockResolvedValue({
        choices: [{ finish_reason: reason, message: { content: "" } }],
      });
      const sdkClient = client as unknown as {
        client: { chat: { completions: { create: unknown } } };
      };
      sdkClient.client.chat.completions.create = create;
      await expect(
        client.complete({
          ...base,
          system: "system",
          messages: [{ role: "user", content: "test" }],
        })
      ).rejects.toMatchObject({ code });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("maps exhausted rate-limit retries to ai_rate_limited", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(
          429,
          { message: "rate limit" },
          "Rate limit reached",
          new Headers({ "retry-after": "0" })
        )
      );

      await expect(
        client.complete({
          ...base,
          system: "system",
          messages: [{ role: "user", content: "Hello" }],
        })
      ).rejects.toMatchObject({
        code: "ai_rate_limited",
      });
    });

    it("preserves Retry-After for durable retries without a nested retry", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(429, {}, "Rate limited", new Headers({ "retry-after": "120" }))
      );
      await expect(
        client.complete({ ...base, system: "system", messages: [], maxAttempts: 1 })
      ).rejects.toMatchObject({
        code: "ai_rate_limited",
        details: { retryAfterMs: expect.any(Number) },
      });
      expect(
        (client as unknown as { cooldownUntil: number }).cooldownUntil - Date.now()
      ).toBeGreaterThan(119_000);
    });

    it("sends requests side by side and never sends one that was cancelled first", async () => {
      const client = await loadClient();
      let finish!: (value: unknown) => void;
      const response = { choices: [{ message: { content: "ok" } }] };
      const create = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        )
        .mockResolvedValue(response);
      (
        client as unknown as { client: { chat: { completions: { create: unknown } } } }
      ).client.chat.completions.create = create;
      const first = client.complete({ ...base, system: "first", messages: [] });
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const abort = new AbortController();
      abort.abort();
      await expect(
        client.complete({ ...base, system: "cancelled", messages: [], signal: abort.signal })
      ).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
      await expect(
        client.complete({ ...base, system: "second", messages: [] })
      ).resolves.toMatchObject({ content: "ok" });
      expect(create).toHaveBeenCalledTimes(2);
      finish(response);
      await expect(first).resolves.toMatchObject({ content: "ok" });
    });

    it("delays the next caller until the provider cooldown expires", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      let limitedAt = 0;
      let resumedAt = 0;
      const create = vi
        .fn()
        .mockImplementationOnce(async () => {
          limitedAt = Date.now();
          throw new OpenAI.APIError(
            429,
            {},
            "Rate limited",
            new Headers({ "retry-after": "0.08" })
          );
        })
        .mockImplementationOnce(async () => {
          resumedAt = Date.now();
          return { choices: [{ message: { content: "ok" } }] };
        });
      (
        client as unknown as { client: { chat: { completions: { create: unknown } } } }
      ).client.chat.completions.create = create;
      await expect(
        client.complete({ ...base, system: "first", messages: [], maxAttempts: 1 })
      ).rejects.toMatchObject({ code: "ai_rate_limited" });
      await expect(
        client.complete({ ...base, system: "second", messages: [] })
      ).resolves.toMatchObject({
        content: "ok",
      });
      expect(resumedAt - limitedAt).toBeGreaterThanOrEqual(75);
    });

    it("spreads the shared cooldown by a random amount past the provider's Retry-After", async () => {
      const { OpenAI } = await import("openai");
      const cooldownAfter = async (random: number) => {
        vi.spyOn(Math, "random").mockReturnValue(random);
        const client = await loadClient();
        stubSdkCreate(
          client,
          new OpenAI.APIError(429, {}, "Rate limited", new Headers({ "retry-after": "120" }))
        );
        await client
          .complete({ ...base, system: "system", messages: [], maxAttempts: 1 })
          .catch(() => undefined);
        vi.restoreAllMocks();
        return (client as unknown as { cooldownUntil: number }).cooldownUntil - Date.now();
      };

      const least = await cooldownAfter(0);
      const most = await cooldownAfter(1);

      expect(least).toBeLessThanOrEqual(120_000);
      expect(most).toBeGreaterThan(121_500);
      expect(most).toBeLessThanOrEqual(122_000);
    });

    it("maps a provider that cannot be reached to ai_provider_unavailable", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(client, new OpenAI.APIConnectionError({ message: "ECONNREFUSED" }));

      await expect(
        client.complete({ ...base, system: "system", messages: [], maxAttempts: 1 })
      ).rejects.toMatchObject({ code: "ai_provider_unavailable", statusCode: 503 });
    });

    it("still maps a connection timeout to ai_timeout", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(client, new OpenAI.APIConnectionTimeoutError());

      await expect(
        client.complete({ ...base, system: "system", messages: [], maxAttempts: 1 })
      ).rejects.toMatchObject({ code: "ai_timeout" });
    });

    it("says when a reply with content was cut off at the output budget", async () => {
      const client = await loadClient();
      const create = vi.fn().mockResolvedValue({
        choices: [{ finish_reason: "length", message: { content: '{"partial":' } }],
      });
      (
        client as unknown as { client: { chat: { completions: { create: unknown } } } }
      ).client.chat.completions.create = create;

      await expect(client.complete({ ...base, system: "system", messages: [] })).resolves.toEqual({
        content: '{"partial":',
        finishReason: "length",
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("maps exhausted 5xx retries to ai_provider_unavailable", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(503, { message: "overloaded" }, "Service unavailable", undefined)
      );

      await expect(
        client.complete({
          ...base,
          system: "system",
          messages: [{ role: "user", content: "Hello" }],
        })
      ).rejects.toMatchObject({
        code: "ai_provider_unavailable",
      });
    });

    it("maps authentication failures to a stable configuration error", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      const apiError = new OpenAI.APIError(
        401,
        { message: "invalid key" },
        "Invalid key",
        undefined
      );
      stubSdkCreate(client, apiError);

      await expect(
        client.complete({
          ...base,
          system: "system",
          messages: [{ role: "user", content: "Hello" }],
        })
      ).rejects.toMatchObject({ code: "ai_configuration_invalid" });
    });
  });
});
