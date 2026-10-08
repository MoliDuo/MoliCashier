import { describe, expect, it } from "vitest";
import {
  DEMO_AI_SCENARIOS,
  answerFor,
  chatCompletionEnvelope,
  readScenarioToken,
  selectScenario,
} from "../../../scripts/demo-ai-server";
import { parserOutputSchema } from "@/modules/source-document/domain/parse/parser-schema";

const PARSE_SCENARIOS = ["success", "slow", "foreign", "unparsable"] as const;

/** The prompt the app builds, with the scenario named where the ledger's custom instructions sit. */
function promptFor(scenario: string): string {
  return `You are an expense evidence parser.\n### Additional Instructions\ndemo:${scenario}\n`;
}

describe("demo AI scenarios", () => {
  it("answers a parse the application's own schema accepts", () => {
    for (const scenario of PARSE_SCENARIOS) {
      const parsed = parserOutputSchema.parse(answerFor(promptFor(scenario)).body);

      if (scenario === "unparsable") {
        expect(parsed.outcome, scenario).toBe("invalid");
        expect(parsed.invalid_reason, scenario).toBe(
          "The document shows no price tied to a single transaction."
        );
      } else {
        expect(parsed.outcome, scenario).toBe("success");
        expect(parsed.ledger_entries.length, scenario).toBeGreaterThan(0);
      }
    }
  });

  it("charges the foreign scenario in a currency the demo has a rate for", () => {
    const parsed = parserOutputSchema.parse(answerFor(promptFor("foreign")).body);

    expect(parsed.ledger_entries[0]?.currency).toBe("USD");
  });

  it("sends valid JSON that the parser schema rejects, not malformed JSON", () => {
    const body = answerFor(promptFor("schema-invalid")).body;
    const content = JSON.stringify(body);

    // Malformed JSON would be caught by the app's repair path and surface as a
    // provider failure; the schema failure is what this scenario exists for.
    expect(() => JSON.parse(content)).not.toThrow();
    expect(parserOutputSchema.safeParse(JSON.parse(content)).success).toBe(false);
  });

  it("refuses a provider-error scenario with an OpenAI-shaped failure", () => {
    const answer = answerFor(promptFor("provider-error"));

    expect(answer.status).toBe(503);
    expect(answer.error).toEqual({ message: "Demo AI provider outage", type: "server_error" });
    expect(answer.body).toBeUndefined();
  });

  it("holds the slow scenario open for the configured time and everything else answers at once", () => {
    expect(answerFor(promptFor("slow"), { slowMs: 900, latencyMs: 5 }).delayMs).toBe(900);
    expect(answerFor(promptFor("success"), { slowMs: 900, latencyMs: 5 }).delayMs).toBe(5);
  });

  it("wraps an answer the way the app's OpenAI client reads it", () => {
    const body = answerFor(promptFor("success")).body;
    const envelope = chatCompletionEnvelope({ model: "gpt-4o" }, JSON.stringify(body));

    expect(envelope.object).toBe("chat.completion");
    expect(envelope.model).toBe("gpt-4o");
    expect(envelope.choices[0]?.message.role).toBe("assistant");
    expect(JSON.parse(envelope.choices[0]?.message.content ?? "")).toEqual(body);
  });
});

describe("demo AI scenario selection", () => {
  it("reads the token the ledger's custom instructions carry", () => {
    expect(readScenarioToken(promptFor("slow"))).toBe("slow");
    expect(readScenarioToken(promptFor("provider-error"))).toBe("provider-error");
    expect(readScenarioToken("no scenario here")).toBeNull();
  });

  it("resolves anything it does not know to the default scenario", () => {
    expect(selectScenario(promptFor("foreign"))).toBe("foreign");
    expect(selectScenario("no scenario here")).toBe("success");
    expect(selectScenario(promptFor("nonesuch"))).toBe("success");
  });

  it("offers a scenario for every state a document can be left in", () => {
    expect(new Set(DEMO_AI_SCENARIOS)).toEqual(
      new Set(["success", "slow", "foreign", "unparsable", "schema-invalid", "provider-error"])
    );
  });
});
