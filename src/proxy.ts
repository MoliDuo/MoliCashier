import { NextResponse, type NextRequest } from "next/server";

/**
 * Pages only. Auth protection for pages is handled by the (protected) layout,
 * and the session cookie is left alone: it was set at sign-in to last until the
 * session's absolute expiry, and the idle expiry is the database's to enforce.
 */
export default function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  // API routes are left out: each one authenticates itself (a session for the
  // browser's routes, a bearer credential for /api/v1), and Next buffers the
  // body of every request the proxy matches — an upload would be held in
  // memory before its route could refuse it. Static files are left out too.
  matcher: ["/((?!api(?:/|$)|_next|.*\\..*).*)"],
};
