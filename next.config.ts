import type { NextConfig } from "next";

const demoProject = process.env.CASHIER_DEMO_PROJECT;
if (demoProject != null && !/^[a-z][a-z0-9-]{0,40}$/.test(demoProject)) {
  throw new Error("CASHIER_DEMO_PROJECT must be a lowercase Compose project name");
}

// `npm run test:smoke` builds and serves from its own directory, so a smoke run
// and `npm run check` in the same checkout never overwrite each other's `.next`.
// Its tsconfig lists that directory's route types instead of `.next`'s: one that
// `extends` another is never rewritten by `next build`, which would otherwise
// add the smoke directory to tsconfig.json.
const smokeBuild = process.env.CASHIER_SMOKE_BUILD === "1";
const distDir = smokeBuild
  ? ".next-smoke"
  : demoProject == null
    ? undefined
    : `.next-${demoProject}`;

// Build remotePatterns from environment
const remotePatterns: Array<{ protocol: "https" | "http"; hostname: string }> = [];

const nextConfig: NextConfig = {
  ...(distDir == null ? {} : { distDir }),
  // instrumentation.ts is enabled by default in Next.js 16+
  // The dev tools badge is fixed to a viewport corner, where it covers the
  // ledger's own footer controls at phone widths — the source-document modal's
  // Evidence button sits underneath it. Development warnings still reach the
  // terminal and the browser console.
  devIndicators: false,
  // `npm run check` type-checks with `next typegen && tsc` before it builds,
  // so its build skips Next's second, identical pass.
  typescript: {
    ...(process.env.CASHIER_CHECK_BUILD === "1" ? { ignoreBuildErrors: true } : {}),
    ...(smokeBuild ? { tsconfigPath: "tsconfig.smoke.json" } : {}),
  },
  experimental: {
    // No `proxyClientMaxBodySize`: the app has no proxy, so no request body is buffered ahead of
    // its route; the large ones (uploads, API v1) go to API routes that authenticate first and
    // read the body with a limit. A repository test keeps a proxy from coming back unnoticed.
    // The ledger's pages are dynamic but carry no data of their own on a
    // client move — React Query holds it — so a page just left is safe to show
    // again at once instead of waiting on the server for the same payload.
    staleTimes: { dynamic: 300 },
  },
  images: {
    unoptimized: true, // Disable Next.js image optimization - images are pre-processed on upload
    remotePatterns,
  },
  // 账目 is the app's front page. Redirecting here answers `/` with a plain 307 before anything
  // renders; a redirect() inside the page came after the streamed shell had started, so the
  // browser had to follow it with a second, client-side navigation.
  async redirects() {
    return [{ source: "/", destination: "/records", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            // `self` lets the new-record form open the phone's camera for
            // photographing a receipt; microphone and geolocation stay off.
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // The three directives that need no nonce, so they cost neither a
            // middleware pass nor static optimization. `frame-ancestors` is the
            // one that earns its place: nothing else here refuses to be framed,
            // and a ledger is exactly the kind of page worth clickjacking. The
            // script and style directives are left out on purpose — a useful
            // one needs per-request nonces, and this app has no HTML injection
            // sink to aim them at.
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
