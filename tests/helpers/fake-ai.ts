import { vi, type Mock } from "vitest";
import type { AiCompletion, AiTransport, CompleteRequest } from "@/lib/ai/client";
import { generateStructured, type GenerateStructured } from "@/lib/ai/structured";

/** What a scripted reply may be: the text alone, or text with token usage. */
export type FakeReply = string | AiCompletion;

export type FakeResponder = (request: CompleteRequest) => FakeReply | Promise<FakeReply>;

export type FakeAiTransport = AiTransport & { complete: Mock<AiTransport["complete"]> };

/**
 * The one way tests fake the model: a transport whose replies a test scripts.
 * Install it with `setAiTransportForTests`, or hand `generateVia(transport)` to
 * code that takes a generator. Either way the real `generateStructured` runs.
 */
export function fakeAiTransport(responder: FakeResponder): FakeAiTransport {
  return {
    complete: vi.fn(async (request: CompleteRequest) => {
      const reply = await responder(request);
      return typeof reply === "string" ? { content: reply } : reply;
    }),
  };
}

/** A generator that runs the real `generateStructured` over the given transport. */
export function generateVia(transport: AiTransport): GenerateStructured {
  return (request) => generateStructured(request, transport);
}
