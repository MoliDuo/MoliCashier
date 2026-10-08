import { API_V1_CREATES_PER_DAY, API_V1_CREATES_PER_MINUTE } from "@/config/tuning";
import { RateLimitedError } from "@/lib/errors";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/**
 * The most callers whose allowance is remembered. Callers are authenticated
 * credentials, and a ledger has only a handful, so this is a backstop; the
 * caller seen longest ago is forgotten first.
 */
const MAX_TRACKED_KEYS = 1024;

interface Allowance {
  /** Requests a caller may make at once, and how long a spent allowance takes to refill. */
  capacity: number;
  periodMs: number;
}

interface Bucket {
  tokens: number[];
  updatedAt: number;
}

/**
 * Token buckets per caller, one for each allowance; a request takes a token from
 * every bucket, and is refused if any is empty. Held in memory: Cashier runs as
 * one process, and a restart only forgives what was spent.
 */
export class RequestLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly allowances: readonly Allowance[],
    private readonly maxKeys = MAX_TRACKED_KEYS
  ) {}

  /** Takes one request for `key`: 0 when allowed, otherwise the whole seconds until it would be. */
  take(key: string, now: number): number {
    const previous = this.buckets.get(key);
    // Deleted and set again below, so the map's order is least recently seen first.
    this.buckets.delete(key);
    const elapsed = previous == null ? 0 : Math.max(0, now - previous.updatedAt);
    const tokens = this.allowances.map((allowance, index) =>
      previous == null
        ? allowance.capacity
        : Math.min(
            allowance.capacity,
            previous.tokens[index]! + (elapsed * allowance.capacity) / allowance.periodMs
          )
    );
    const waitMs = Math.max(
      0,
      ...this.allowances.map((allowance, index) =>
        tokens[index]! >= 1 ? 0 : ((1 - tokens[index]!) * allowance.periodMs) / allowance.capacity
      )
    );
    this.buckets.set(key, {
      tokens: waitMs === 0 ? tokens.map((count) => count - 1) : tokens,
      updatedAt: now,
    });
    if (this.buckets.size > this.maxKeys) {
      this.buckets.delete(this.buckets.keys().next().value!);
    }
    return waitMs === 0 ? 0 : Math.max(1, Math.ceil(waitMs / 1000));
  }

  get trackedKeys(): number {
    return this.buckets.size;
  }
}

const sourceDocumentCreations = new RequestLimiter([
  { capacity: API_V1_CREATES_PER_MINUTE, periodMs: MINUTE_MS },
  { capacity: API_V1_CREATES_PER_DAY, periodMs: DAY_MS },
]);

/** Counts one source-document creation against a credential, or throws RateLimitedError. */
export function takeSourceDocumentCreation(credentialId: string, now = Date.now()): void {
  const retryAfterSeconds = sourceDocumentCreations.take(credentialId, now);
  if (retryAfterSeconds > 0) throw new RateLimitedError(retryAfterSeconds);
}
