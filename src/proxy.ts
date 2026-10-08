import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/modules/auth/constants";

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  // API routes must be classified before dotted static-looking paths. The
  // proxy has no database, so it only turns away requests with no session
  // cookie at all; each route reads and checks the session itself.
  if (pathname.startsWith("/api/")) {
    const isPublicApi = pathname.startsWith("/api/v1/") || pathname.startsWith("/api/auth/");
    if (!isPublicApi && (sessionToken == null || sessionToken === "")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Auth protection for pages is handled by the (protected) layout. The session
  // cookie is left alone: it was set at sign-in to last until the session's
  // absolute expiry, and the idle expiry is the database's to enforce.
  return NextResponse.next();
}

export const config = {
  // Matcher ignoring static files
  matcher: ["/api/:path*", "/((?!_next|.*\\..*).*)"],
};
