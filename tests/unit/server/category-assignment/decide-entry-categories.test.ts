import { afterEach, describe, expect, it } from "vitest";
import { setAiTransportForTests, type AiContentPart } from "@/lib/ai/client";
import { AI_CATEGORY_REQUEST_TIMEOUT_MS } from "@/config/tuning";
import type {
  CategoryAssignmentCandidate,
  CategoryAssignmentDocumentGroup,
} from "@/modules/ledger/domain/category-assignment-protocol";
import { decideEntryCategories } from "@/server/category-assignment/decide-entry-categories";
import {
  fakeAiTransport,
  type FakeAiTransport,
  type FakeResponder,
} from "../../../helpers/fake-ai";

type SentMessage = { role: string; content: AiContentPart[] };

let transport: FakeAiTransport;

/** Installs a transport that answers every request with the next scripted reply. */
function reply(...contents: string[]): void {
  let next = 0;
  const responder: FakeResponder = () => contents[Math.min(next++, contents.length - 1)] ?? "";
  transport = fakeAiTransport(responder);
  setAiTransportForTests(transport);
}

function firstRequest() {
  const call = transport.complete.mock.calls[0];
  if (call == null) throw new Error("complete was not called");
  return call[0];
}

const candidates: CategoryAssignmentCandidate[] = [
  { id: "cat-food", name: "吃喝", description: null },
  { id: "cat-home", name: "居家", description: null },
];

function group(
  overrides: Partial<CategoryAssignmentDocumentGroup> = {}
): CategoryAssignmentDocumentGroup {
  return {
    sourceDocumentId: "doc-1",
    title: null,
    documentDate: "2026-09-10",
    inputText: null,
    storedFileIds: [],
    subjects: [
      {
        ledgerEntryId: "entry-1",
        itemName: "Lunch",
        description: null,
        amount: "45.00",
        currency: "CNY",
        currentCategoryId: null,
        currentCategoryName: null,
      },
    ],
    ...overrides,
  };
}

function sentMessages(): SentMessage[] {
  return firstRequest().messages as SentMessage[];
}

function sentText(): string {
  return sentMessages()
    .flatMap((message) => message.content)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

describe("entryCategoryDeciderAdapter", () => {
  afterEach(() => {
    setAiTransportForTests(null);
  });

  it("resolves the model's indices back onto category ids", async () => {
    reply('```json\n{ "decisions": [{ "entry_index": 1, "category_index": 2 }] }\n```');

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).resolves.toEqual({
      decisions: [{ ledgerEntryId: "entry-1", categoryId: "cat-home" }],
      confirmedCount: 0,
    });
  });

  it("accepts the model's notes and ignores them", async () => {
    reply(
      '{"document_context":"Convenience store snack run","decisions":[{"entry_index":1,"reason":"Store sells food","category_index":1}]}'
    );

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).resolves.toEqual({
      decisions: [{ ledgerEntryId: "entry-1", categoryId: "cat-food" }],
      confirmedCount: 0,
    });
  });

  it("asks with the call's own limits and forwards the abort signal", async () => {
    reply('{"decisions":[{"entry_index":1,"category_index":1}]}');
    const controller = new AbortController();

    await decideEntryCategories({
      candidates,
      group: group(),
      images: [],
      signal: controller.signal,
    });

    const request = firstRequest();
    expect(request.system).toContain("吃喝");
    expect(request).toMatchObject({
      maxTokens: 6000,
      temperature: 0.1,
      maxAttempts: 1,
      timeoutMs: AI_CATEGORY_REQUEST_TIMEOUT_MS,
      signal: controller.signal,
    });
  });

  it("recovers from a reply that is not JSON through the repair round", async () => {
    reply("I could not decide.", '{"decisions":[{"entry_index":1,"category_index":2}]}');

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).resolves.toEqual({
      decisions: [{ ledgerEntryId: "entry-1", categoryId: "cat-home" }],
      confirmedCount: 0,
    });
    expect(transport.complete).toHaveBeenCalledTimes(2);
  });

  it("fails when the answer does not cover every entry", async () => {
    reply('{"decisions":[]}');

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({ code: "ai_schema_invalid" });
  });

  it("fails when the answer points past the candidate list", async () => {
    reply('{"decisions":[{"entry_index":1,"category_index":3}]}');

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({ code: "ai_schema_invalid" });
  });

  it("sends the document's own context, not just the entries", async () => {
    reply('{"decisions":[{"entry_index":1,"category_index":1}]}');

    await decideEntryCategories({
      candidates,
      group: group({ title: "全家便利店", documentDate: "2026-09-10", inputText: "楼下买的" }),
      images: [],
    });

    const body = sentText();
    expect(body).toContain("document_title: 全家便利店");
    expect(body).toContain("document_date: 2026-09-10");
    expect(body).toContain("submitted_text: 楼下买的");
    expect(body).toContain("1. item_name: Lunch");
  });

  it("passes the document's images through as content parts, in order", async () => {
    reply('{"decisions":[{"entry_index":1,"category_index":1}]}');

    await decideEntryCategories({
      candidates,
      group: group({ storedFileIds: ["f1", "f2"] }),
      images: [{ dataUrl: "data:image/jpeg;base64,AAA" }, { dataUrl: "data:image/png;base64,BBB" }],
    });

    const [message] = sentMessages();
    expect(message).toEqual({
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("attached_images: 2") },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
        { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
      ],
    });
  });

  it("rejects a response that is not JSON", async () => {
    reply("I could not decide.");

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
  });

  it("rejects a response that does not match the schema", async () => {
    reply('{ "decisions": [{ "entry_index": 0, "category_index": 1 }] }');

    await expect(
      decideEntryCategories({ candidates, group: group(), images: [] })
    ).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
  });
});
