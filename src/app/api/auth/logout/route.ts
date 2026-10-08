import { NextResponse } from "next/server";
import { runtimeEnv } from "@/lib/env/runtime";
import { isSameOriginRequest } from "@/lib/http/same-origin";
import { SIGNED_OUT_COOKIE_NAME } from "@/modules/auth/constants";
import { endSession } from "@/modules/auth/server/current-session";
import { signedOutCookieOptions } from "@/modules/auth/server/signed-out-cookie";

export const dynamic = "force-dynamic";

/**
 * Ends this browser's session. It is a route and not a server action on purpose:
 * an action that deletes the cookie also re-renders the page it was called from,
 * and that page would redirect to the sign-in that signs the person straight
 * back in. The marker cookie covers the navigations that can still land on the
 * login page before the caller loads the signed-out screen itself.
 *
 * Only the app's own pages may call it. `SameSite=Lax` keeps the session cookie
 * off a cross-site POST, but not off one from a sibling subdomain, which is
 * same-site; checking the origin closes that, and keeps another page from
 * planting the signed-out marker.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request, runtimeEnv.appUrl)) {
    return NextResponse.json(
      { error: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  await endSession();
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SIGNED_OUT_COOKIE_NAME, "1", signedOutCookieOptions());
  return response;
}
