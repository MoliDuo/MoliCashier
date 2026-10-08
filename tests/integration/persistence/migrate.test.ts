import { describe, expect, it } from "vitest";
import { withMigrationLock } from "@/persistence/migrate";
import { getTestPool } from "tests/setup";

describe("withMigrationLock", () => {
  it("bounds lock waits while migrating and releases the lock afterwards", async () => {
    const client = await getTestPool().connect();
    try {
      const timeout = await withMigrationLock(
        client,
        async () => (await client.query<{ lock_timeout: string }>("SHOW lock_timeout")).rows[0]
      );
      expect(timeout?.lock_timeout).toBe("10s");
      const held = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()"
      );
      expect(held.rows[0]?.count).toBe("0");
    } finally {
      await client.query("RESET lock_timeout");
      client.release();
    }
  });

  it("reports the migration's error when the unlock fails too", async () => {
    const client = await getTestPool().connect();
    try {
      // The failed statement leaves the session in an aborted transaction, so
      // the unlock that follows fails as well.
      const run = withMigrationLock(client, async () => {
        await client.query("BEGIN");
        await client.query("SELECT 1 / 0");
      });
      await expect(run).rejects.toThrow(/division by zero/);
    } finally {
      // Discard the session; closing it releases the advisory lock.
      client.release(true);
    }
  });
});
