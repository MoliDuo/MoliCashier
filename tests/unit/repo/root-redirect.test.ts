import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("front page", () => {
  it("sends / to 账目 before rendering anything", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];

    expect(redirects).toContainEqual({ source: "/", destination: "/records", permanent: false });
  });
});
