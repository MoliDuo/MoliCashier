/**
 * The HTTPS front of the production smoke run.
 *
 * The session cookie is a Secure `__Host-` cookie, as it is in production.
 * Chromium keeps Secure cookies on http://127.0.0.1, but WebKit on Linux (the
 * `iphone` project) neither stores nor sends them without TLS, so over plain
 * HTTP it could never be signed in. The run therefore serves the app the way
 * production does, over HTTPS: this proxy terminates TLS with a throwaway
 * self-signed certificate, which the specs accept through `ignoreHTTPSErrors`,
 * and forwards every request unchanged to the Next.js server on loopback.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

export interface Certificate {
  key: string;
  cert: string;
}

/** A one-day certificate for 127.0.0.1, made by the `openssl` on the PATH and never written to the repository. */
export function createSelfSignedCertificate(): Certificate {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cashier-smoke-tls-"));
  try {
    const keyPath = path.join(directory, "key.pem");
    const certPath = path.join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" }
    );
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Forwards each request to `target` (an http:// origin) with its method, path,
 * headers and body, and streams the answer back. The Host header goes through
 * as the browser sent it and the scheme as `x-forwarded-proto`, so the server
 * sees the origin the browser is on, the one APP_URL names.
 */
export function createSmokeHttpsProxy(target: URL, certificate: Certificate): https.Server {
  const server = https.createServer(certificate, (request, response) => {
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers: { ...withoutHopByHop(request.headers), "x-forwarded-proto": "https" },
        // A fresh connection each time: a pooled one the server is just closing
        // would fail the request for a reason no deployment has.
        agent: false,
      },
      (answer) => {
        response.writeHead(
          answer.statusCode ?? 502,
          answer.statusMessage,
          withoutHopByHop(answer.headers)
        );
        answer.pipe(response);
      }
    );
    upstream.once("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    // A browser that gives up on a request (a prefetch it no longer needs)
    // ends the upstream one with it.
    response.once("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  // Longer than a browser keeps an idle connection to reuse, so the proxy never
  // closes one under a request the browser is just sending on it.
  server.keepAliveTimeout = 120_000;
  return server;
}

/** Headers that describe one connection, which the proxy's two connections do not share. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
]);

function withoutHopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase()))
  );
}
