import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/persistence";
import { runtimeEnv } from "@/lib/env/runtime";
import { resolvePostgresSsl } from "@/lib/db/ssl";
import { logger } from "@/lib/logger";

const globalForDb = global as unknown as {
  pool: Pool | undefined;
};

function createPool(): Pool {
  const created = new Pool({
    connectionString: runtimeEnv.databaseUrl,
    ssl: resolvePostgresSsl(runtimeEnv.databaseUrl, process.env.NODE_ENV),
    max: runtimeEnv.databasePoolMax,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    // A session left idle inside a transaction (a request that died between
    // statements) would otherwise hold its row locks indefinitely.
    idle_in_transaction_session_timeout: 60_000,
    // Keep idle sockets alive through NAT and proxy idle timeouts, so a
    // silently dropped connection is noticed instead of hanging a query.
    keepAlive: true,
  });
  // An idle client losing its connection (a database restart, a terminated
  // backend) emits "error" on the pool; without a listener that would crash
  // the process. The pool discards the client and opens a new one when needed.
  // Only the code and message are logged; never the connection string.
  created.on("error", (error: Error & { code?: string }) => {
    logger.error(
      { error: { code: error.code, message: error.message } },
      "Idle database client failed"
    );
  });
  return created;
}

const pool = globalForDb.pool ?? createPool();

globalForDb.pool = pool;

export const db = drizzle(pool, { schema });

/** The pool itself, for the few callers that need a dedicated session (advisory locks). */
export const databasePool: Pool = pool;

/** Ends the pool, so a command-line script can exit once its work is done. */
export async function closeDatabase(): Promise<void> {
  globalForDb.pool = undefined;
  await pool.end();
}
