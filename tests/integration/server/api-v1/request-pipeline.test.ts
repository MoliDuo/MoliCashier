import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { ledgers, serviceCredentials } from "@/persistence";
import { computeHash, prefixSuffix } from "@/lib/security/service-credential-token";
import { handleApiV1Route } from "@/server/api-v1/request-pipeline";

describe("handleApiV1Route", () => {
  let credentialId = "";
  let credentialKey = "";
  const handler = vi.fn();

  function call(authorization?: string) {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("Authorization", authorization);
    return handleApiV1Route(new NextRequest("http://localhost/api/v1/probe", { headers }), {
      logContext: "probe",
      handler,
    });
  }

  beforeEach(async () => {
    handler.mockReset();
    handler.mockResolvedValue({ response: NextResponse.json({ ok: true }) });

    const db = getTestDb();
    await db.delete(ledgers);
    await createTestLedger(db);
    credentialKey = `sk_pipeline_${crypto.randomUUID().replace(/-/g, "")}`;
    const { prefix, suffix } = prefixSuffix(credentialKey);
    const [credential] = await db
      .insert(serviceCredentials)
      .values({
        name: "Pipeline Credential",
        tokenHash: computeHash(credentialKey),
        bookId: await testBookId(db),
        tokenPrefix: prefix,
        tokenSuffix: suffix,
      })
      .returning({ id: serviceCredentials.id });
    credentialId = credential!.id;
  });

  it("challenges a request without a usable bearer key", async () => {
    for (const authorization of [undefined, "Bearer", "Bearer a b", "Bearer sk_unknown"]) {
      const response = await call(authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts the scheme in any letter case and hands the handler the credential", async () => {
    for (const scheme of ["bearer", "BEARER"]) {
      await expect(call(`${scheme} ${credentialKey}`)).resolves.toMatchObject({ status: 200 });
    }

    expect(handler).toHaveBeenCalledTimes(2);
    const context = handler.mock.calls[0]?.[0];
    expect(context.credential).toMatchObject({ id: credentialId });
    expect(context.credential).not.toHaveProperty("tokenHash");
    expect(context.requestId).toEqual(expect.any(String));
  });

  it("stamps a request id on a response and never limits the rate", async () => {
    for (let request = 0; request < 3; request += 1) {
      const response = await call(`Bearer ${credentialKey}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBe(handler.mock.calls[request]?.[0].requestId);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-RateLimit-Limit")).toBeNull();
    }
  });
});
