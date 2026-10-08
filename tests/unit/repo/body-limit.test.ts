import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import nextConfig from "../../../next.config";
import { config } from "@/proxy";

/**
 * Next buffers the body of every request the proxy matches, and past
 * `proxyClientMaxBodySize` (10 MB by default) silently drops the rest. The
 * large bodies — web uploads, API v1 — go to API routes, and each API route
 * authenticates itself before it reads its body, so the proxy must not match
 * them.
 */
describe("request bodies", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url });

  it("reach API routes without passing through the proxy", () => {
    for (const url of [
      "/api",
      "/api/v1/source-documents",
      "/api/stored-files",
      "/api/ledger-queries",
      "/api/auth/logout",
      "/api/private/file.json",
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("still pass pages, and paths that only start with 'api', through the proxy", () => {
    for (const url of ["/", "/login", "/settings", "/healthz", "/apiary"]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("skip the proxy for static files and build assets", () => {
    for (const url of ["/_next/static/chunk.js", "/favicon.ico"]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("are not held to a proxy-specific limit, since no large body passes through it", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
  });
});
