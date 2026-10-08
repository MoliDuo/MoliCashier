import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

function createRequest(path: string, sessionToken?: string, origin = "http://localhost:3000") {
  const headers = new Headers();
  if (sessionToken != null) headers.set("cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
  return new NextRequest(new URL(path, origin), { headers });
}

describe("proxy", () => {
  describe("public routes", () => {
    it("lets public pages through without a session", () => {
      for (const path of ["/login", "/s/some-share-id"]) {
        expect(proxy(createRequest(path)).status).toBe(200);
      }
    });

    it("lets the sign-in routes through without a session, since that is how one starts", () => {
      for (const path of ["/api/auth/login", "/auth/callback"]) {
        expect(proxy(createRequest(path)).status).toBe(200);
      }
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

  describe("API routes", () => {
    it("returns 401 without a session cookie", async () => {
      const res = proxy(createRequest("/api/protected"));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("lets a request with a session cookie through for the route to check", () => {
      expect(proxy(createRequest("/api/protected", "token")).status).toBe(200);
    });

    it("leaves API v1 to authenticate itself", () => {
      expect(proxy(createRequest("/api/v1/documents")).status).toBe(200);
    });

    it("answers the health check without a session", () => {
      expect(proxy(createRequest("/healthz")).status).toBe(200);
    });

    it("does not treat the retired cron route as public", () => {
      expect(proxy(createRequest("/api/cron/daily")).status).toBe(401);
    });

    it("does not let a dot bypass API authentication", () => {
      expect(proxy(createRequest("/api/private/file.json")).status).toBe(401);
    });
  });

  it("skips _next paths", () => {
    expect(proxy(createRequest("/_next/static/chunk.js")).status).toBe(200);
  });
});
