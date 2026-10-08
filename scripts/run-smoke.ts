import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@/persistence";
import { migrateDatabase } from "@/persistence/migrate";
import { createDemoAiServer } from "./demo-ai-server";
import { seedBooks, seedCategories, seedLedger } from "./lib/seed";
import { tsxArgs } from "./lib/tsx";
import { prepareTestPostgres } from "./prepare-test-postgres";
import { createSelfSignedCertificate, createSmokeHttpsProxy } from "./smoke-https-proxy";
import { createSmokeOidcServer } from "./smoke-oidc-server";
import { createSmokeObjectStorage } from "./smoke-object-storage";

// Next.js needs its port before it starts, because the HTTPS proxy in front of
// it forwards there, and it only binds after a build that takes a minute. A port
// the kernel handed out and took back sits in the ephemeral range, where any
// outbound connection in that minute (the build's own, Postgres clients) can
// claim it and leave the server unable to listen. Picking below that range keeps
// it out of the kernel's hands; the helper servers bind port 0 and keep what
// they got.
const isPortAvailable = async (port: number): Promise<boolean> => {
  const probe = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE") return false;
    throw error;
  } finally {
    if (probe.listening) await new Promise((resolve) => probe.close(resolve));
  }
};
const pickAppPort = async (): Promise<number> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("Could not find a free port for the smoke server");
};
const listenOnAnyPort = async (server: net.Server): Promise<number> => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
};
const closeServer = async (server: net.Server): Promise<void> => {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
};
const stop = async (child: ChildProcess | undefined): Promise<void> => {
  if (child == null || child.exitCode != null || child.signalCode != null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
};

// The signal that stopped the run, so the exit code says so (130 for SIGINT, 143 for SIGTERM) the
// way run-check and run-vitest report it.
let interruptedBy: NodeJS.Signals | undefined;

async function main(): Promise<void> {
  const adminUrl = new URL(
    process.env.TEST_DATABASE_URL ?? "postgresql://cashier:cashier@127.0.0.1:55432/cashier_test"
  );
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(adminUrl.hostname) ||
    adminUrl.pathname !== "/cashier_test"
  ) {
    throw new Error(
      "Smoke tests require a loopback cashier_test database with CREATEDB permission."
    );
  }
  const postgres = await prepareTestPostgres();
  adminUrl.href = postgres.databaseUrl;
  const databaseName = `smoke_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const port = await pickAppPort();
  const aiServer = createDemoAiServer({ latencyMs: 3_000 });
  const aiPort = await listenOnAnyPort(aiServer);
  const storageServer = createSmokeObjectStorage({ log: console.log });
  const storagePort = await listenOnAnyPort(storageServer);
  // The browsers reach the app over HTTPS, as in production, through a proxy in
  // front of the Next.js server (see smoke-https-proxy.ts for why).
  const serverURL = `http://127.0.0.1:${port}`;
  const httpsProxy = createSmokeHttpsProxy(new URL(serverURL), createSelfSignedCertificate());
  const baseURL = `https://127.0.0.1:${await listenOnAnyPort(httpsProxy)}`;
  // The upload path is part of what production does, so the run points it at an
  // in-memory S3 endpoint instead of a bucket: the image still travels through
  // the real client, and nothing leaves this machine or outlives the run.
  const storageEndpoint = `http://127.0.0.1:${storagePort}`;
  // Sign-in goes through the real OIDC client too, to a provider on loopback
  // that signs in whoever a spec tells it to.
  const oidcClient = { clientId: "cashier-smoke", clientSecret: randomUUID() };
  const oidcServer = createSmokeOidcServer(oidcClient).server;
  const oidcEndpoint = `http://127.0.0.1:${await listenOnAnyPort(oidcServer)}`;
  const smokeEmail = "smoke@example.com";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl.toString(),
    APP_URL: baseURL,
    AUTH_SECRET: randomUUID(),
    OIDC_ISSUER_URL: oidcEndpoint,
    OIDC_CLIENT_ID: oidcClient.clientId,
    OIDC_CLIENT_SECRET: oidcClient.clientSecret,
    OPENAI_API_KEY: "smoke-unused",
    OPENAI_BASE_URL: `http://127.0.0.1:${aiPort}/v1`,
    S3_ENDPOINT: storageEndpoint,
    S3_BUCKET: "smoke-objects",
    S3_ACCESS_KEY_ID: "smoke-unused",
    S3_SECRET_ACCESS_KEY: "smoke-unused",
    S3_FORCE_PATH_STYLE: "true",
    // `next build` compiles NODE_ENV in as "production", so the dev sign-in is
    // off in this server whatever this says; the specs sign in through
    // tests/smoke/sign-in.ts instead.
    DEV_AUTH_BYPASS: "false",
    TZ: "UTC",
    // next.config.ts builds and serves this run from `.next-smoke`, apart from the gate's `.next`.
    CASHIER_SMOKE_BUILD: "1",
    SMOKE_BASE_URL: baseURL,
    SMOKE_EMAIL: smokeEmail,
    SMOKE_OIDC_URL: oidcEndpoint,
  };
  let activeChild: ChildProcess | undefined;
  let server: ChildProcess | undefined;
  let created = false;
  let interrupted = false;
  const run = async (args: string[]): Promise<void> => {
    if (interrupted) throw new Error("Smoke test interrupted");
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    activeChild = child;
    const [code] = (await once(child, "exit")) as [number | null];
    activeChild = undefined;
    if (code !== 0) throw new Error(`Smoke subprocess failed (${code})`);
  };
  const waitForServer = async (child: ChildProcess): Promise<void> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode != null || child.signalCode != null) {
        throw new Error("Next.js exited before the smoke server became ready");
      }
      try {
        // Straight to the server: /login would redirect to the provider and back
        // to the HTTPS address, whose certificate this fetch does not trust.
        const response = await fetch(`${serverURL}/healthz`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Smoke server did not become ready within 60 seconds");
  };
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted = true;
    interruptedBy = signal;
    activeChild?.kill("SIGTERM");
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    await migrateDatabase(databaseUrl.toString());
    const client = new pg.Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
      // One ledger with two books: a record written from 总账 lands in whichever
      // book the writer picked (or the first one, 共同支出).
      const db = drizzle(client, { schema });
      await seedLedger(db, { mainCurrency: "CNY" });
      await seedBooks(db, ["共同支出", "旅行支出"]);
      await seedCategories(
        db,
        ["Food", "Shopping", "Travel"].map((name) => ({ name }))
      );
    } finally {
      await client.end();
    }
    // The build points next-env.d.ts at `.next-smoke`'s route types; put it back
    // so `tsc` and the editor keep reading `.next`'s.
    const nextEnv = await readFile("next-env.d.ts", "utf8").catch(() => undefined);
    try {
      await run(["node_modules/next/dist/bin/next", "build", "--webpack"]);
    } finally {
      if (nextEnv == null) await rm("next-env.d.ts", { force: true });
      else await writeFile("next-env.d.ts", nextEnv);
    }
    await run(tsxArgs("scripts/check-protected-route-bundle.ts"));
    server = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
      { env, stdio: "inherit" }
    );
    // Without this, a server that never came up leaves every spec to time out
    // against whatever answers on the port, and the real error scrolls past.
    await waitForServer(server);
    // The @demo spec needs the dev sign-in, which a production build cannot
    // offer (NODE_ENV is compiled in as production). It runs under
    // `npm run test:demo`, which boots the demo environment instead.
    await run([
      "node_modules/@playwright/test/cli.js",
      "test",
      "--grep-invert",
      "@demo",
      ...process.argv.slice(2),
    ]);
  } finally {
    await stop(activeChild);
    await stop(server);
    await closeServer(aiServer);
    await closeServer(storageServer);
    await closeServer(oidcServer);
    httpsProxy.closeAllConnections();
    await closeServer(httpsProxy);
    if (created && /^smoke_[a-f0-9]{32}$/.test(databaseName)) {
      const target = await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [
        databaseName,
      ]);
      if (target.rows.length === 1) {
        console.log(`[smoke] Removing this run's database: ${databaseName}`);
        await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      }
    }
    await admin.end();
    await postgres.cleanup();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = interruptedBy === "SIGINT" ? 130 : interruptedBy === "SIGTERM" ? 143 : 1;
});
