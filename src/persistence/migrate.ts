import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * Applies the migrations to a database. It is the one way every database gets
 * its schema — `npm run db:migrate` on deploy, the demo and smoke databases,
 * and the template each integration test file copies — so they all go through
 * the same lock and the same baseline guard.
 */

const migrationsFolder = fileURLToPath(new URL("./postgres-migrations", import.meta.url));
const MIGRATION_LOCK = 112835438754;
/** How long a migration statement waits for a table lock before it fails. */
const MIGRATION_LOCK_TIMEOUT = "10s";

interface MigrationJournal {
  entries: Array<{ tag: string; when: number }>;
}

/**
 * The migrations before `0000_baseline` were folded into it. Drizzle skips every
 * migration not newer than the last one a database recorded, so a database
 * that stopped short of the baseline would silently miss the folded changes.
 * Refuse it instead; the `pre-baseline` tag still carries the full chain.
 */
export async function assertBaselineReached(
  client: pg.ClientBase,
  migrationsSchema: string
): Promise<void> {
  const journal = JSON.parse(
    readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")
  ) as MigrationJournal;
  const baseline = journal.entries.find((entry) => entry.tag === "0000_baseline");
  if (baseline == null) throw new Error("migration journal has no 0000_baseline entry");
  const table = `${client.escapeIdentifier(migrationsSchema)}.__drizzle_migrations`;
  const exists = await client.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [table]
  );
  if (exists.rows[0]?.exists !== true) return;
  const latest = await client.query<{ latest: string | null }>(
    `SELECT max(created_at)::text AS latest FROM ${table}`
  );
  const applied = latest.rows[0]?.latest;
  if (applied == null || Number(applied) >= baseline.when) return;
  throw new Error(
    "this database predates the migration baseline; deploy the `pre-baseline` git tag " +
      "first so it applies the migrations folded into 0000_baseline, then deploy this release"
  );
}

/**
 * Brings the database at `connectionString` up to the latest migration. Runs
 * hold an advisory lock, so concurrent deploys apply each migration once. The
 * migration log sits in `drizzle` beside a `public` schema, and in
 * `<schema>_migrations` beside any other.
 */
export async function migrateDatabase(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await withMigrationLock(client, async () => {
      const schema = (await client.query<{ name: string }>("SELECT current_schema() AS name"))
        .rows[0]?.name;
      const migrationsSchema = schema === "public" ? "drizzle" : `${schema}_migrations`;
      await assertBaselineReached(client, migrationsSchema);
      await migrate(drizzle(client), { migrationsFolder, migrationsSchema });
    });
  } finally {
    await client.end();
  }
}

/**
 * Runs `run` while holding the migration advisory lock on `client`'s session,
 * so concurrent deploys apply each migration once.
 *
 * Once the lock is held, statements wait at most `lock_timeout` for a table
 * lock, so a migration stuck behind a long transaction fails and rolls back
 * instead of queueing every later query on that table behind it. Waiting for
 * the advisory lock itself stays unbounded: that is another deploy migrating.
 *
 * A failed unlock never replaces the error that ended the run; closing the
 * session releases the lock anyway.
 */
export async function withMigrationLock<T>(
  client: pg.ClientBase,
  run: () => Promise<T>
): Promise<T> {
  await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
  let result: T;
  try {
    await client.query(`SET lock_timeout = '${MIGRATION_LOCK_TIMEOUT}'`);
    result = await run();
  } catch (error) {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    throw error;
  }
  await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  return result;
}
