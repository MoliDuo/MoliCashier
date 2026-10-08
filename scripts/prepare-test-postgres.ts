import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { z } from "zod";

const DATABASE_NAME = "cashier_test";
const IMAGE = "postgres:17-alpine";
const STARTUP_TIMEOUT_MS = 120_000;

/** The slice of a `pg.Pool` this module uses, so tests can stand in for it. */
interface QueryPool {
  query<Row extends pg.QueryResultRow>(
    sql: string,
    values?: unknown[]
  ): Promise<pg.QueryResult<Row>>;
  end(): Promise<void>;
}

type PoolConstructor = new (config: pg.PoolConfig) => QueryPool;

interface ContainerOptions {
  image: string;
  database: string;
  username: string;
  password: string;
  startupTimeoutMs: number;
}

interface StartedContainer {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

type ContainerFactory = (options: ContainerOptions) => Promise<StartedContainer>;

type Logger = Pick<Console, "info">;

export interface TestPostgres {
  databaseUrl: string;
  runId: string;
  cleanup(): Promise<void>;
}

const postgresTestUrlSchema = z
  .string()
  .trim()
  .regex(/^postgres(?:ql)?:\/\//, "TEST_DATABASE_URL must be a PostgreSQL connection URL")
  .superRefine((value, context) => {
    try {
      const databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
      if (!databaseName.endsWith("_test")) {
        context.addIssue({
          code: "custom",
          message: "TEST_DATABASE_URL database name must end with _test",
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "TEST_DATABASE_URL must be a valid URL" });
    }
  });

export function createTestRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function sanitizeIdentifierPart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]/g, "_");
  if (sanitized.length === 0) throw new Error("Cannot derive a PostgreSQL identifier component");
  if (sanitized.length > 40) {
    throw new Error("CASHIER_TEST_RUN_ID is too long for a PostgreSQL test database name");
  }
  return sanitized;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function validateTestDatabaseUrl(value: string): string {
  return postgresTestUrlSchema.parse(value);
}

/** The database a run's file, or its template, lives in; every one shares the run prefix. */
export function runDatabaseName(runId: string, suffix: string): string {
  return `test_${sanitizeIdentifierPart(runId)}_${sanitizeIdentifierPart(suffix)}`;
}

/** The same server and credentials as `baseUrl`, pointed at another database. */
export function databaseUrlFor(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

export async function listRunDatabases(
  pool: Pick<QueryPool, "query">,
  runId: string
): Promise<string[]> {
  const prefix = `test_${sanitizeIdentifierPart(runId)}_`;
  const result = await pool.query<{ datname: string }>(
    `SELECT datname
     FROM pg_database
     WHERE left(datname, char_length($1)) = $1
     ORDER BY datname`,
    [prefix]
  );
  return result.rows.map(({ datname }) => datname);
}

export async function cleanupRunDatabases(
  pool: Pick<QueryPool, "query">,
  runId: string,
  logger: Logger = console
): Promise<void> {
  const prefix = `test_${sanitizeIdentifierPart(runId)}_`;
  const databases = await listRunDatabases(pool, runId);
  if (databases.length > 0) logger.info(`Cleaning ${databases.length} test databases`);

  for (const databaseName of databases) {
    if (!databaseName.startsWith(prefix)) {
      throw new Error(`Refusing to remove unexpected PostgreSQL database: ${databaseName}`);
    }
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
  }
}

async function verifyExternalDatabase(pool: QueryPool): Promise<void> {
  await pool.query("SELECT 1");
  const role = await pool.query<{ can_create: boolean }>(
    "SELECT rolcreatedb OR rolsuper AS can_create FROM pg_roles WHERE rolname = current_user"
  );
  if (role.rows[0]?.can_create !== true) {
    throw new Error("TEST_DATABASE_URL user must be allowed to create databases");
  }
}

// The container is thrown away after the run, so durability buys nothing: the
// data lives in memory and no write waits on a disk flush.
const THROWAWAY_SERVER_SETTINGS = ["fsync=off", "synchronous_commit=off", "full_page_writes=off"];

async function defaultContainerFactory(options: ContainerOptions): Promise<StartedContainer> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  return new PostgreSqlContainer(options.image)
    .withDatabase(options.database)
    .withUsername(options.username)
    .withPassword(options.password)
    .withTmpFs({ "/var/lib/postgresql": "rw" })
    .withCommand(["postgres", ...THROWAWAY_SERVER_SETTINGS.flatMap((setting) => ["-c", setting])])
    .withStartupTimeout(options.startupTimeoutMs)
    .start();
}

async function startContainer(containerFactory: ContainerFactory): Promise<StartedContainer> {
  try {
    return await containerFactory({
      image: IMAGE,
      database: DATABASE_NAME,
      username: "cashier",
      password: "cashier",
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(
      "Unable to start the test PostgreSQL container. Start Docker and retry; npm test remains available without Docker.",
      { cause: error }
    );
  }
}

export async function prepareTestPostgres({
  environment = process.env,
  runId = createTestRunId(),
  containerFactory = defaultContainerFactory,
  Pool = pg.Pool,
  logger = console,
}: {
  environment?: NodeJS.ProcessEnv;
  runId?: string;
  containerFactory?: ContainerFactory;
  Pool?: PoolConstructor;
  logger?: Logger;
} = {}): Promise<TestPostgres> {
  const externalUrl = environment.TEST_DATABASE_URL?.trim();
  let container: StartedContainer | undefined;
  let pool: QueryPool | undefined;

  try {
    let databaseUrl: string;
    let openPool: QueryPool;
    if (externalUrl) {
      databaseUrl = validateTestDatabaseUrl(externalUrl);
      openPool = pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      try {
        await verifyExternalDatabase(openPool);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`TEST_DATABASE_URL validation failed: ${message}`, { cause: error });
      }
    } else {
      container = await startContainer(containerFactory);
      databaseUrl = container.getConnectionUri();
      openPool = pool = new Pool({ connectionString: databaseUrl, max: 1 });
      await openPool.query("SELECT 1");
    }

    const startedContainer = container;
    let cleaned = false;
    return {
      databaseUrl,
      runId,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        let cleanupError: unknown;
        try {
          await cleanupRunDatabases(openPool, runId, logger);
        } catch (error) {
          cleanupError = error;
        } finally {
          await openPool.end().catch((error: unknown) => {
            cleanupError ??= error;
          });
          await startedContainer?.stop().catch((error: unknown) => {
            cleanupError ??= error;
          });
        }
        if (cleanupError) throw cleanupError;
      },
    };
  } catch (error) {
    await pool?.end().catch(() => {});
    await container?.stop().catch(() => {});
    throw error;
  }
}

async function main(): Promise<void> {
  const resource = await prepareTestPostgres();
  try {
    console.info("Test PostgreSQL environment is ready.");
  } finally {
    await resource.cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
