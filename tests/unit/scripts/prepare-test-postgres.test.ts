import { describe, expect, it, vi } from "vitest";
import {
  cleanupRunDatabases,
  databaseUrlFor,
  prepareTestPostgres,
  runDatabaseName,
  validateTestDatabaseUrl,
} from "../../../scripts/prepare-test-postgres";

function createPoolClass(query: (sql: string, values?: unknown[]) => unknown) {
  const instances: Array<{ query: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = [];
  class FakePool {
    query = vi.fn(query);
    end = vi.fn(async () => {});

    constructor() {
      instances.push(this);
    }
  }
  return { Pool: FakePool, instances };
}

describe("test PostgreSQL preparation", () => {
  it("rejects unsafe external database URLs", () => {
    expect(() => validateTestDatabaseUrl("mysql://localhost/cashier_test")).toThrow(
      "PostgreSQL connection URL"
    );
    expect(() => validateTestDatabaseUrl("postgresql://localhost/cashier")).toThrow(
      "must end with _test"
    );
  });

  it("does not fall back to a container when an external database cannot connect", async () => {
    const connectionError = new Error("connection refused");
    const { Pool } = createPoolClass(async () => {
      throw connectionError;
    });
    const containerFactory = vi.fn();

    await expect(
      prepareTestPostgres({
        environment: {
          NODE_ENV: "test",
          TEST_DATABASE_URL: "postgresql://localhost/cashier_test",
        } as NodeJS.ProcessEnv,
        runId: "external-run",
        Pool: Pool as never,
        containerFactory,
      })
    ).rejects.toThrow("TEST_DATABASE_URL validation failed: connection refused");
    expect(containerFactory).not.toHaveBeenCalled();
  });

  it("reports Docker startup failures without constructing a database pool", async () => {
    const { Pool, instances } = createPoolClass(async () => ({ rows: [] }));

    await expect(
      prepareTestPostgres({
        environment: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
        runId: "docker-failure",
        Pool: Pool as never,
        containerFactory: vi.fn(async () => {
          throw new Error("daemon unavailable");
        }) as never,
      })
    ).rejects.toThrow("Start Docker and retry; npm test remains available without Docker");
    expect(instances).toHaveLength(0);
  });

  it("starts an isolated container and releases it", async () => {
    const { Pool, instances } = createPoolClass(async (sql) => {
      if (sql.includes("FROM pg_database")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const stop = vi.fn(async () => {});
    const containerFactory = vi.fn(async () => ({
      getConnectionUri: () => "postgresql://cashier:cashier@127.0.0.1:49123/cashier_test",
      stop,
    }));

    const resource = await prepareTestPostgres({
      environment: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      runId: "container-run",
      Pool: Pool as never,
      containerFactory: containerFactory as never,
    });
    await resource.cleanup();
    await resource.cleanup();

    expect(containerFactory).toHaveBeenCalledWith({
      image: "postgres:17-alpine",
      database: "cashier_test",
      username: "cashier",
      password: "cashier",
      startupTimeoutMs: 120_000,
    });
    expect(instances[0]?.end).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("refuses an external database whose user cannot create databases", async () => {
    const { Pool } = createPoolClass(async (sql) =>
      sql.includes("FROM pg_roles") ? { rows: [{ can_create: false }] } : { rows: [] }
    );

    await expect(
      prepareTestPostgres({
        environment: {
          NODE_ENV: "test",
          TEST_DATABASE_URL: "postgresql://localhost/cashier_test",
        } as NodeJS.ProcessEnv,
        runId: "external-run",
        Pool: Pool as never,
        containerFactory: vi.fn(),
      })
    ).rejects.toThrow("must be allowed to create databases");
  });

  it("names a run's databases under its prefix on the same server", () => {
    expect(runDatabaseName("run-1", "p1_w2")).toBe("test_run_1_p1_w2");
    expect(
      databaseUrlFor("postgresql://u:p@127.0.0.1:5432/cashier_test?ssl=0", "test_run_1_p1_w2")
    ).toBe("postgresql://u:p@127.0.0.1:5432/test_run_1_p1_w2?ssl=0");
  });

  it("enumerates and removes only databases belonging to the current run", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM pg_database")) {
        expect(values).toEqual(["test_run_1_"]);
        return { rows: [{ datname: "test_run_1_template" }, { datname: "test_run_1_p1_w1" }] };
      }
      return { rows: [] };
    });

    await cleanupRunDatabases({ query } as never, "run-1", { info: vi.fn() } as never);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]?.[0]).toBe(
      'DROP DATABASE IF EXISTS "test_run_1_template" WITH (FORCE)'
    );
    expect(query.mock.calls[2]?.[0]).toBe(
      'DROP DATABASE IF EXISTS "test_run_1_p1_w1" WITH (FORCE)'
    );
  });
});
