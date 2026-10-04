import { afterEach, describe, expect, it } from "vitest";
import { setAiTransportForTests } from "@/lib/ai/client";
import { generateCategoryMetadata } from "@/modules/ledger/server/category-metadata";
import { fakeAiTransport } from "../../../../helpers/fake-ai";

const input = { categoryName: "Groceries", existingCategoryNames: ["Rent", "Transport"] };

describe("generateCategoryMetadata", () => {
  afterEach(() => {
    setAiTransportForTests(null);
  });

  it("returns the icon and description from a valid reply, with its own output budget", async () => {
    const transport = fakeAiTransport(
      () => '{"icon":"ShoppingCart","description":"Food and household supplies"}'
    );
    setAiTransportForTests(transport);

    await expect(generateCategoryMetadata(input)).resolves.toEqual({
      icon: "ShoppingCart",
      description: "Food and household supplies",
    });

    expect(transport.complete).toHaveBeenCalledTimes(1);
    expect(transport.complete.mock.calls[0]?.[0]).toMatchObject({
      maxTokens: 180,
      temperature: 0.2,
    });
  });

  it("repairs an unknown icon, and fails with ai_schema_invalid when it stays unknown", async () => {
    const transport = fakeAiTransport(() => '{"icon":"NotAnIcon","description":"Food"}');
    setAiTransportForTests(transport);

    await expect(generateCategoryMetadata(input)).rejects.toMatchObject({
      code: "ai_schema_invalid",
      statusCode: 502,
    });
    expect(transport.complete).toHaveBeenCalledTimes(2);
    expect(transport.complete.mock.calls[1]?.[0].system).toContain("- icon:");
  });

  it("accepts the icon the repair round corrects", async () => {
    const transport = fakeAiTransport((request) =>
      request.system.includes("JSON repair")
        ? '{"icon":"ShoppingCart","description":"Food"}'
        : '{"icon":"NotAnIcon","description":"Food"}'
    );
    setAiTransportForTests(transport);

    await expect(generateCategoryMetadata(input)).resolves.toEqual({
      icon: "ShoppingCart",
      description: "Food",
    });
  });
});
