import "server-only";
import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { keyedDigest } from "@/lib/security/keys";
import { sessions } from "@/persistence";
import { SESSION_ABSOLUTE_MAX_AGE_DAYS, SESSION_MAX_AGE_DAYS } from "@/config/tuning";

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * DAY_MS;
const SESSION_ABSOLUTE_MAX_AGE_MS = SESSION_ABSOLUTE_MAX_AGE_DAYS * DAY_MS;
/** A session is extended at most once a day, so reads rarely write. */
const SESSION_RENEW_AFTER_MS = DAY_MS;

export interface SessionUser {
  sessionId: string;
  /** The address the identity provider vouched for at sign-in, for display. */
  email: string | null;
  expiresAt: Date;
}

function hashSessionToken(token: string): string {
  return keyedDigest("session", token);
}

/** The latest a session opened at `createdAt` can last, however often it is renewed. */
function absoluteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_ABSOLUTE_MAX_AGE_MS);
}

/**
 * Opens a session for a person the identity provider has just vouched for.
 * `expiresAt` is the idle expiry the database enforces; `absoluteExpiresAt` is
 * the hard end, which the cookie carries since no renewal reaches past it.
 */
export async function createSession(
  email: string,
  now = new Date()
): Promise<{ token: string; expiresAt: Date; absoluteExpiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const absoluteExpiresAt = absoluteExpiry(now);
  const expiresAt = new Date(
    Math.min(now.getTime() + SESSION_MAX_AGE_MS, absoluteExpiresAt.getTime())
  );
  await db.insert(sessions).values({
    tokenHash: hashSessionToken(token),
    email,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt, absoluteExpiresAt };
}

/**
 * The live session a cookie names. A session last seen over a day ago is pushed
 * out to a full idle lifetime from now, but never past its absolute expiry:
 * however often it is used, a session ends that long after sign-in.
 */
export async function readSession(token: string, now = new Date()): Promise<SessionUser | null> {
  const row = await db
    .select({
      sessionId: sessions.id,
      email: sessions.email,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        gt(sessions.expiresAt, now),
        // Sessions renewed before the absolute expiry existed can carry an
        // `expires_at` past it, so the age is checked on its own.
        gt(sessions.createdAt, new Date(now.getTime() - SESSION_ABSOLUTE_MAX_AGE_MS))
      )
    )
    .limit(1)
    .then((rows) => rows[0]);
  if (row == null) return null;

  let expiresAt = row.expiresAt;
  if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_RENEW_AFTER_MS) {
    expiresAt = new Date(
      Math.min(now.getTime() + SESSION_MAX_AGE_MS, absoluteExpiry(row.createdAt).getTime())
    );
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, row.sessionId));
  }

  return { sessionId: row.sessionId, email: row.email, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}
