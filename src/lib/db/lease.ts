import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { LEASE_DURATION_MS, LEASE_HEARTBEAT_MS } from "@/config/tuning";

// The one lease rule every background flow shares. Leases are timed by the
// database clock only, so workers on different machines agree on expiry: a
// lease is held while its expiry is later than `clock_timestamp()` and free
// otherwise. `leaseFree` and `leaseHeldBy` are exact opposites for one token.

type LeaseColumn = AnyPgColumn | SQL;

/** The lease can be claimed: nobody holds it, or its holder let it expire. */
export function leaseFree(token: LeaseColumn, expiresAt: LeaseColumn): SQL {
  return sql`(${token} IS NULL OR ${expiresAt} <= clock_timestamp())`;
}

/** The lease is still held by this token; writes that finish work fence on it. */
export function leaseHeldBy(token: LeaseColumn, expiresAt: LeaseColumn, claimToken: string): SQL {
  return sql`(${token} = ${claimToken} AND ${expiresAt} > clock_timestamp())`;
}

/** The expiry a claim or renewal sets. */
export function leaseExpiry(): SQL {
  return sql`clock_timestamp() + make_interval(secs => ${LEASE_DURATION_MS / 1000})`;
}

/** A moment the given delay from the database clock, for scheduling a retry. */
export function databaseClockPlus(delayMs: number): SQL {
  return sql`clock_timestamp() + make_interval(secs => ${delayMs / 1000})`;
}

export interface HeldLease {
  /** Aborts once the lease is lost or cannot be renewed. */
  signal: AbortSignal;
  stop(): void;
}

/**
 * How long before a lease runs out a holder that could not renew it gives up, so the work stops
 * while the lease still covers it and no second holder can have claimed it yet.
 */
const LEASE_SAFETY_MARGIN_MS = LEASE_HEARTBEAT_MS / 2;

/**
 * Renews a lease on a heartbeat while its work runs. The work is aborted as soon as a renewal
 * finds the lease gone. A renewal that fails, say while the database restarts, is tried again on
 * the next heartbeat; only once the lease, as last renewed, is about to run out is the work
 * aborted, since a worker that cannot prove it still holds the lease must not go on to write
 * results. A renewal that hangs counts the same as one that fails.
 */
export function holdLease(
  renew: () => Promise<boolean>,
  onLost: (reason: "lost" | "renewal_failed", error?: unknown) => void
): HeldLease {
  const controller = new AbortController();
  let beatTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastError: unknown;

  const clearTimers = () => {
    if (beatTimer != null) clearTimeout(beatTimer);
    if (deadlineTimer != null) clearTimeout(deadlineTimer);
  };

  const lose = (reason: "lost" | "renewal_failed", error?: unknown) => {
    if (stopped || controller.signal.aborted) return;
    clearTimers();
    if (reason === "lost") onLost(reason);
    else onLost(reason, error);
    controller.abort();
  };

  /** The lease, renewed from `renewedAt`, runs until then plus its duration; give up just before. */
  const armDeadline = (renewedAt: number) => {
    if (deadlineTimer != null) clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(
      () => lose("renewal_failed", lastError),
      Math.max(0, renewedAt + LEASE_DURATION_MS - LEASE_SAFETY_MARGIN_MS - Date.now())
    );
  };

  const beat = async (): Promise<void> => {
    if (stopped || controller.signal.aborted) return;
    const startedAt = Date.now();
    try {
      if (!(await renew())) {
        lose("lost");
        return;
      }
      lastError = undefined;
      // The database set the new expiry during the call, so counting from its start is safe.
      armDeadline(startedAt);
    } catch (error) {
      lastError = error;
    }
    if (!stopped && !controller.signal.aborted) {
      beatTimer = setTimeout(() => void beat(), LEASE_HEARTBEAT_MS);
    }
  };
  armDeadline(Date.now());
  beatTimer = setTimeout(() => void beat(), LEASE_HEARTBEAT_MS);

  return {
    signal: controller.signal,
    stop() {
      stopped = true;
      clearTimers();
    },
  };
}
