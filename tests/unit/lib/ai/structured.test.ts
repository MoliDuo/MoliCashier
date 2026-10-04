import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { generateStructured } from "@/lib/ai/structured";
import { fakeAiTransport } from "../../../helpers/fake-ai";

const schema = z.object({ name: z.string(), count: z.number().int() });

const base = {
  task: "test-task",
  schema,
  system: "Answer as JSON.",
  messages: [{ role: "user" as const, content: "go" }],
  maxTokens: 500,
  temperature: 0.4,
};

describe("generateStructured", () => {
  it("returns the validated value for a plain JSON reply", async () => {
    const transport = fakeAiTransport(() => '{"name":"a","count":2}');
    await expect(generateStructured(base, transport)).resolves.toEqual({ name: "a", count: 2 });
    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({
      system: "Answer as JSON.",
      messages: [{ role: "user", content: "go" }],
      maxTokens: 500,
      temperature: 0.4,
    });
  });

  it("reads JSON out of a fenced block", async () => {
    const transport = fakeAiTransport(() => '```json\n{"name":"a","count":2}\n```');
    await expect(generateStructured(base, transport)).resolves.toEqual({ name: "a", count: 2 });
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });

  it("reads JSON out of surrounding prose", async () => {
    const transport = fakeAiTransport(() => 'Sure! Here you go: {"name":"a","count":2} Enjoy.');
    await expect(generateStructured(base, transport)).resolves.toEqual({ name: "a", count: 2 });
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });

  it("repairs a JSON syntax error with one more call that reuses the request's limits", async () => {
    const controller = new AbortController();
    const broken = '{"name":"a","count":}';
    const transport = fakeAiTransport((request) =>
      request.system === base.system ? broken : '{"name":"a","count":3}'
    );

    await expect(
      generateStructured(
        { ...base, signal: controller.signal, maxAttempts: 1, timeoutMs: 1234 },
        transport
      )
    ).resolves.toEqual({ name: "a", count: 3 });

    expect(transport.complete).toHaveBeenCalledTimes(2);
    const second = transport.complete.mock.calls[1]?.[0];
    expect(second?.system).toContain("The reply is not valid JSON.");
    expect(second?.system).toContain(broken);
    expect(second).toMatchObject({
      maxTokens: 500,
      temperature: 0.4,
      maxAttempts: 1,
      timeoutMs: 1234,
      signal: controller.signal,
    });
  });

  it("repairs a reply that parses but fails the schema, naming the offending path", async () => {
    const transport = fakeAiTransport((request) =>
      request.system === base.system ? '{"name":"a","count":"many"}' : '{"name":"a","count":4}'
    );

    await expect(generateStructured(base, transport)).resolves.toEqual({ name: "a", count: 4 });
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(transport.complete.mock.calls[1]?.[0].system).toContain("- count:");
  });

  it("makes no second call and throws when repair is disabled", async () => {
    const transport = fakeAiTransport(() => '{"name":"a"}');
    await expect(generateStructured({ ...base, repair: false }, transport)).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });

  it("throws ai_schema_invalid without echoing model content when the repair is also invalid", async () => {
    const secret = "SECRET-RECEIPT-TEXT";
    const transport = fakeAiTransport(() => `{"name":"${secret}"}`);

    const error = await generateStructured(base, transport).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
      details: { task: "test-task", repaired: true },
    });
    expect(JSON.stringify((error as AppError).details)).not.toContain(secret);
    expect((error as AppError).message).not.toContain(secret);
    expect(transport.complete).toHaveBeenCalledTimes(2);
  });

  it("lets transport errors through unchanged, without a repair call", async () => {
    const failure = new AppError("rate limited", "ai_rate_limited", 503);
    const transport = fakeAiTransport(() => {
      throw failure;
    });

    await expect(generateStructured(base, transport)).rejects.toBe(failure);
    expect(transport.complete).toHaveBeenCalledTimes(1);
  });

  it("reports the summed usage once, repair included", async () => {
    const onUsage = vi.fn();
    const transport = fakeAiTransport((request) =>
      request.system === base.system
        ? { content: "nope", usage: { promptTokens: 10, completionTokens: 5 } }
        : { content: '{"name":"a","count":1}', usage: { promptTokens: 20, completionTokens: 7 } }
    );

    await generateStructured({ ...base, onUsage }, transport);

    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ promptTokens: 30, completionTokens: 12 });
  });

  it("does not report usage when the provider gave none", async () => {
    const onUsage = vi.fn();
    const transport = fakeAiTransport(() => '{"name":"a","count":1}');

    await generateStructured({ ...base, onUsage }, transport);

    expect(onUsage).not.toHaveBeenCalled();
  });

  it("forwards the abort signal to the transport", async () => {
    const controller = new AbortController();
    const transport = fakeAiTransport(() => '{"name":"a","count":1}');

    await generateStructured({ ...base, signal: controller.signal }, transport);

    expect(transport.complete.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });
});
