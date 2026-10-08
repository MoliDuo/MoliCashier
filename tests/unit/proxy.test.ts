import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

function createRequest(path: string, sessionToken?: string, origin = "http://localhost:3000") {
  const headers = new Headers();
  if (sessionToken != null) headers.set("cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
  return new NextRequest(new URL(path, origin), { headers });
}

// Which paths reach the proxy at all is the matcher's business, tested in
// tests/unit/repo/body-limit.test.ts.
describe("proxy", () => {
  describe("public routes", () => {
    it("lets public pages through without a session", () => {
      for (const path of ["/login", "/s/some-share-id", "/auth/callback"]) {
        expect(proxy(createRequest(path)).status).toBe(200);
      }
    });

    it("answers the health check without a session", () => {
      expect(proxy(createRequest("/healthz")).status).toBe(200);
    });
  });

  describe("pages", () => {
    it("leaves page authorization to the protected layouts", () => {
      expect(proxy(createRequest("/dashboard")).status).toBe(200);
      expect(proxy(createRequest("/dashboard", "token")).status).toBe(200);
    });

    it("leaves the session cookie's expiry as sign-in set it", () => {
      // The cookie lasts until the session's absolute expiry; refreshing it on
      // every page load would keep it alive past that.
      const res = proxy(createRequest("/", "token", "https://cashier.example"));

      expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it("sets no cookie for a browser that has none", () => {
      expect(proxy(createRequest("/")).cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    });
  });
});
