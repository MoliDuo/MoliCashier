import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";
import { createSession, deleteSession, readSession, type SessionUser } from "./sessions";

/** The session this request's cookie names, read once per request. */
export const getCurrentSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token == null || token === "") return null;
  return readSession(token);
});

/**
 * Signs the browser in: replaces the session its cookie named, if any, with a
 * new one. Server actions only, since only they may set cookies. The cookie
 * lives until the session's absolute expiry and is never refreshed; the idle
 * expiry is the database's to enforce.
 */
export async function startSession(email: string): Promise<void> {
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE_NAME)?.value;
  if (previous != null && previous !== "") await deleteSession(previous);
  const { token, absoluteExpiresAt } = await createSession(email);
  jar.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: absoluteExpiresAt,
  });
}

/** Signs the browser out. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (token != null && token !== "") await deleteSession(token);
  // Not jar.delete(): browsers refuse to change a `__Host-` cookie unless the response is Secure too.
  jar.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
