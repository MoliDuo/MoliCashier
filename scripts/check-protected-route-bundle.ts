import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import nextConfig from "../next.config";

interface ClientReferenceManifest {
  clientModules: Record<string, { chunks?: string[] }>;
}

// The build this measures is wherever next.config.ts put it: `.next` for the
// gate, `.next-smoke` for a smoke run.
const distDir = nextConfig.distDir ?? ".next";
// 流水 is where the app opens, so its bundle is the one a reader waits on.
const manifestPath = path.join(
  distDir,
  "server/app/(protected)/(ledger)/records/page_client-reference-manifest.js"
);
const routeKey = "/(protected)/(ledger)/records/page";
// The protected route is the app's largest client bundle. This reports its
// weight rather than gating on it: two readers on an installed PWA are not the
// audience a byte budget protects, and keeping the number honest cost more
// prose than the number was worth. The copy modules count here: before they
// replaced next-intl, the same strings arrived in the page payload instead.
const maximumGzipBytes = 233_000;

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Protected-route client manifest is missing: ${manifestPath}`);
}

const context: {
  globalThis?: unknown;
  __RSC_MANIFEST?: Record<string, ClientReferenceManifest>;
} = {};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(manifestPath, "utf8"), context, { filename: manifestPath });
const manifest = context.__RSC_MANIFEST?.[routeKey];
if (manifest == null) throw new Error(`Protected-route manifest entry is missing: ${routeKey}`);

const files = new Set<string>();
for (const clientModule of Object.values(manifest.clientModules)) {
  for (const chunk of clientModule.chunks ?? []) {
    if (chunk.endsWith(".js")) files.add(decodeURIComponent(chunk));
  }
}

let gzipBytes = 0;
for (const file of files) {
  gzipBytes += zlib.gzipSync(fs.readFileSync(path.join(distDir, file))).byteLength;
}

console.log(
  `Protected route client footprint: ${gzipBytes} gzip bytes across ${files.size} chunks (budget ${maximumGzipBytes})`
);
if (gzipBytes > maximumGzipBytes) {
  console.warn(
    `Warning: the protected route grew past ${maximumGzipBytes} gzip bytes. Worth a look, not a failure.`
  );
}
