import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { sessions } from "@/persistence";
import { DEV_AUTH_EMAIL } from "@/modules/auth/dev-auth";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { createTestLedger } from "tests/helpers/schema-setup";

const jar = vi.hoisted(() => new Map<string, string>());
const cookieOptions = vi.hoisted(() => new Map<string, unknown>());

// The shared setup stands in a session; these tests sign in for real.
vi.unmock("@/modules/auth/server/current-session");

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options?: unknown) => {
      jar.set(name, value);
      cookieOptions.set(name, options);
    },
    delete: (name: string) => void jar.delete(name),
  }),
}));

import { devSignInAction } from "@/modules/auth/server-actions/sign-in";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { requireAuth } from "@/modules/auth/server/session-guards";

describe("sign-in actions", () => {
  const originalBypass = process.env.DEV_AUTH_BYPASS;

  beforeEach(() => {
    jar.clear();
    cookieOptions.clear();
  });

  afterEach(() => {
    if (originalBypass == null) delete process.env.DEV_AUTH_BYPASS;
    else process.env.DEV_AUTH_BYPASS = originalBypass;
  });

  it("signs in as the dev address, and the cookie then names the session", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestLedger(getTestDb());

    await expect(devSignInAction()).resolves.toEqual({ ok: true });

    expect(jar.get(SESSION_COOKIE_NAME)).toMatch(/^[\w-]{43}$/);
    await expect(getCurrentSession()).resolves.toMatchObject({ email: DEV_AUTH_EMAIL });
    await expect(requireAuth()).resolves.toMatchObject({ email: DEV_AUTH_EMAIL });
  });

  it("keeps the cookie until thirty days after sign-in, the session's hard end", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestLedger(getTestDb());

    await devSignInAction();

    const [row] = await getTestDb().select().from(sessions);
    expect(cookieOptions.get(SESSION_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      secure: true,
      expires: new Date(row!.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  it("replaces the browser's previous session when it signs in again", async () => {
    process.env.DEV_AUTH_BYPASS = "true";
    await createTestLedger(getTestDb());

    await devSignInAction();
    const first = jar.get(SESSION_COOKIE_NAME);
    await devSignInAction();

    expect(jar.get(SESSION_COOKIE_NAME)).not.toBe(first);
    expect(await getTestDb().select().from(sessions)).toHaveLength(1);
  });

  it("refuses the dev sign-in when the bypass is off", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    await createTestLedger(getTestDb());

    await expect(devSignInAction()).resolves.toEqual({ ok: false });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });
});
