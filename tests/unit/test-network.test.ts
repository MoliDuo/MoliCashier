import { describe, expect, it } from "vitest";
import { takeUnexpectedHttpErrors } from "../setup.network";

describe("the test network", () => {
  it("fails a request no handler answers and reports it after the test", async () => {
    const response = await fetch("https://unhandled.example/path?secret=1");
    expect(response.status).toBe(500);

    const errors = takeUnexpectedHttpErrors();
    expect(errors.map((error) => error.message)).toEqual([
      "TEST_UNEXPECTED_HTTP GET https://unhandled.example",
    ]);
  });

  it("still answers the requests it has handlers for", async () => {
    const response = await fetch("https://api.openai.com/v1/models");

    expect(response.status).toBe(503);
  });
});
