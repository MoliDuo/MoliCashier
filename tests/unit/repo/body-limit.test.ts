import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

const root = path.resolve(__dirname, "../../..");

/**
 * Next buffers the body of every request a proxy (formerly middleware) matches, and past
 * `proxyClientMaxBodySize` (10 MB by default) silently drops the rest. The app has no proxy: the
 * (protected) layout checks the session for pages, and each API route authenticates itself before
 * it reads its body, so a large upload is never buffered ahead of the route that may refuse it.
 */
describe("request bodies", () => {
  it("never pass through a proxy, because the app has none", () => {
    for (const file of ["proxy", "middleware"].flatMap((name) =>
      ["ts", "tsx", "js", "mjs"].map((extension) => `src/${name}.${extension}`)
    )) {
      expect(existsSync(path.join(root, file)), file).toBe(false);
    }
  });

  it("are not held to a proxy-specific limit, since no large body passes through one", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
  });
});
