import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { holdLease, leaseExpiry, leaseFree, leaseHeldBy } from "@/lib/db/lease";
import { LEASE_DURATION_MS, LEASE_HEARTBEAT_MS } from "@/config/tuning";

const token = sql`claim_token`;
const expiresAt = sql`claim_expires_at`;

async function claim(id: string, claimToken: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE lease_probe SET claim_token = ${claimToken}, claim_expires_at = ${leaseExpiry()}
    WHERE id = ${id} AND ${leaseFree(token, expiresAt)}
    RETURNING id
  `);
  return result.rows.length === 1;
}

async function held(id: string, claimToken: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT id FROM lease_probe WHERE id = ${id} AND ${leaseHeldBy(token, expiresAt, claimToken)}
  `);
  return result.rows.length === 1;
}

async function setExpiry(id: string, expiry: SQL) {
  await db.execute(sql`UPDATE lease_probe SET claim_expires_at = ${expiry} WHERE id = ${id}`);
}

async function probe(): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(sql`INSERT INTO lease_probe (id) VALUES (${id})`);
  return id;
}

beforeAll(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lease_probe (
      id uuid PRIMARY KEY, claim_token text, claim_expires_at timestamptz
    )
  `);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("database-clock leases", () => {
  it("grants a free lease for the configured duration and refuses a second claim", async () => {
    const id = await probe();
    await expect(claim(id, "first")).resolves.toBe(true);
    await expect(claim(id, "second")).resolves.toBe(false);

    const row = await db.execute<{ seconds: number }>(sql`
      SELECT extract(epoch FROM claim_expires_at - clock_timestamp())::float AS seconds
      FROM lease_probe WHERE id = ${id}
    `);
    expect(Number(row.rows[0]!.seconds)).toBeGreaterThan(LEASE_DURATION_MS / 1000 - 5);
    expect(Number(row.rows[0]!.seconds)).toBeLessThanOrEqual(LEASE_DURATION_MS / 1000);
  });

  it("treats a lease as free exactly when it is not held", async () => {
    const id = await probe();
    await claim(id, "first");
    await expect(held(id, "first")).resolves.toBe(true);
    await expect(held(id, "other")).resolves.toBe(false);

    // Expiring at this very instant already counts as expired.
    await setExpiry(id, sql`clock_timestamp()`);
    await expect(held(id, "first")).resolves.toBe(false);
    await expect(claim(id, "second")).resolves.toBe(true);
    await expect(held(id, "first")).resolves.toBe(false);
    await expect(held(id, "second")).resolves.toBe(true);
  });
});

describe("holding a lease", () => {
  it("renews on every heartbeat until stopped", async () => {
    vi.useFakeTimers();
    const renew = vi.fn(async () => true);
    const lease = holdLease(renew, vi.fn());

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2);
    expect(renew).toHaveBeenCalledTimes(2);
    lease.stop();
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(lease.signal.aborted).toBe(false);
  });

  const lost = async (): Promise<boolean> => false;
  const failing = async (): Promise<boolean> => {
    throw new Error("database unavailable");
  };

  it("aborts the work as soon as a renewal finds the lease gone", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const lease = holdLease(lost, onLost);

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);

    expect(lease.signal.aborted).toBe(true);
    expect(onLost).toHaveBeenCalledWith("lost");
    lease.stop();
  });

  it("keeps trying a renewal that fails while the lease still has time left", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const renew = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(true);
    const lease = holdLease(renew, onLost);

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2);
    expect(renew).toHaveBeenCalledTimes(2);
    // Renewed on the second beat, so the lease runs well past its first expiry.
    await vi.advanceTimersByTimeAsync(LEASE_DURATION_MS);

    expect(lease.signal.aborted).toBe(false);
    expect(onLost).not.toHaveBeenCalled();
    lease.stop();
  });

  it("aborts the work before the lease runs out when every renewal fails", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const lease = holdLease(failing, onLost);

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 2);
    expect(lease.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LEASE_DURATION_MS - LEASE_HEARTBEAT_MS * 2 - 1);

    expect(lease.signal.aborted).toBe(true);
    expect(onLost).toHaveBeenCalledWith("renewal_failed", expect.any(Error));
    lease.stop();
  });

  it("aborts the work when a renewal hangs past the lease", async () => {
    vi.useFakeTimers();
    const onLost = vi.fn();
    const lease = holdLease(() => new Promise<boolean>(() => undefined), onLost);

    await vi.advanceTimersByTimeAsync(LEASE_DURATION_MS);

    expect(lease.signal.aborted).toBe(true);
    expect(onLost).toHaveBeenCalledWith("renewal_failed", undefined);
    lease.stop();
  });
});
