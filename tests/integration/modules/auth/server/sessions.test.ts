import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestDb, getTestPool } from "tests/setup";
import { sessions } from "@/persistence";
import { eq } from "drizzle-orm";
import { createSession, deleteSession, readSession } from "@/modules/auth/server/sessions";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sessions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a new session back with the address it was opened for", async () => {
    const now = new Date("2026-09-01T00:00:00.000Z");

    const { token, expiresAt, absoluteExpiresAt } = await createSession("owner@example.com", now);
    const session = await readSession(token, now);

    expect(session).toMatchObject({ email: "owner@example.com", expiresAt });
    expect(expiresAt.getTime() - now.getTime()).toBe(14 * DAY_MS);
    expect(absoluteExpiresAt.getTime() - now.getTime()).toBe(30 * DAY_MS);
  });

  it("stores only a digest of the token", async () => {
    const { token } = await createSession("owner@example.com");

    const rows = await getTestDb().select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(token);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the session in a single query", async () => {
    const { token } = await createSession("owner@example.com");
    const query = vi.spyOn(getTestPool(), "query");

    await readSession(token);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("extends a session seen over a day ago, and only then", async () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token, expiresAt } = await createSession("owner@example.com", start);

    const sameDay = await readSession(token, new Date(start.getTime() + DAY_MS - 1));
    expect(sameDay?.expiresAt).toEqual(expiresAt);

    const nextDay = new Date(start.getTime() + DAY_MS);
    const renewed = await readSession(token, nextDay);
    expect(renewed?.expiresAt).toEqual(new Date(nextDay.getTime() + 14 * DAY_MS));
  });

  it("never renews a session past thirty days from sign-in", async () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token, absoluteExpiresAt } = await createSession("owner@example.com", start);

    // Used every few days, the session is renewed each time, until the cap.
    let last: Awaited<ReturnType<typeof readSession>> = null;
    for (let day = 5; day < 30; day += 5) {
      last = await readSession(token, new Date(start.getTime() + day * DAY_MS));
      expect(last).not.toBeNull();
    }
    expect(last?.expiresAt).toEqual(absoluteExpiresAt);

    expect(await readSession(token, new Date(absoluteExpiresAt.getTime() - 1))).not.toBeNull();
    expect(await readSession(token, absoluteExpiresAt)).toBeNull();
  });

  it("does not read a session older than thirty days whose expiry was pushed past that", async () => {
    // Sessions renewed before the cap existed can carry such an expiry.
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token } = await createSession("owner@example.com", start);
    const now = new Date(start.getTime() + 30 * DAY_MS);
    await getTestDb()
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + 14 * DAY_MS) })
      .where(eq(sessions.email, "owner@example.com"));

    expect(await readSession(token, new Date(now.getTime() - 1))).not.toBeNull();
    expect(await readSession(token, now)).toBeNull();
  });

  it("does not read an expired session", async () => {
    const start = new Date("2026-09-01T00:00:00.000Z");
    const { token, expiresAt } = await createSession("owner@example.com", start);

    expect(await readSession(token, expiresAt)).toBeNull();
  });

  it("does not read an unknown token", async () => {
    expect(await readSession("not-a-session")).toBeNull();
  });

  it("ends one session and leaves the others", async () => {
    const first = await createSession("owner@example.com");
    const second = await createSession("owner@example.com");

    await deleteSession(first.token);

    expect(await readSession(first.token)).toBeNull();
    expect(await readSession(second.token)).not.toBeNull();
  });
});
