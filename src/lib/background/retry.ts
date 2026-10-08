import { AppError } from "@/lib/errors";

// The one retry policy every background flow shares.

/**
 * Transient failures are worth another attempt later; permanent ones will
 * fail the same way again; configuration failures need an operator.
 */
export type FailureKind = "transient" | "permanent" | "configuration";

export interface ClassifiedFailure {
  kind: FailureKind;
  /** The code the failure was classified by, when one was found. */
  code: string | null;
  /** How long the provider asked callers to wait, when it said. */
  retryAfterMs: number | null;
}

/** Application error codes for an outage or a limit that passes on its own. */
const TRANSIENT_APP_CODES = new Set([
  "ai_rate_limited",
  "ai_provider_unavailable",
  "ai_timeout",
  // A reply cut off at the token limit; replies vary, so the next run may fit.
  "ai_output_truncated",
]);
const CONFIGURATION_CODES = new Set(["ai_configuration_invalid"]);
/**
 * PostgreSQL SQLSTATEs for a server that is restarting, full or resolving a conflict: admin
 * shutdown, too many connections, serialization failure, deadlock. Class 08 (connection
 * exceptions) is matched as a whole.
 */
const TRANSIENT_SQLSTATES = new Set(["57P01", "53300", "40001", "40P01"]);
/** Node's codes for a connection that was refused, dropped or timed out. */
const TRANSIENT_NETWORK_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);
/** What node-postgres's pool throws when no connection frees up in time. */
const POOL_CONNECT_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

/** Every error in the `cause` chain, outermost first. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current != null && chain.length < 10 && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

/** The first application error code in the `cause` chain. */
export function findAppErrorCode(error: unknown): string | null {
  const found = causeChain(error).find((item): item is AppError => item instanceof AppError);
  return found?.code ?? null;
}

function isClientError(status: unknown): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

/** The code that marks this one error as transient, or null when it does not. */
function transientCode(item: unknown): string | null {
  if (item instanceof AppError) {
    if (TRANSIENT_APP_CODES.has(item.code)) return item.code;
    // Object storage that answered 5xx, timed out or could not be reached; a 4xx is no outage.
    if (item.code === "S3_DOWNLOAD_FAILED" && !isClientError(item.details?.httpStatusCode)) {
      return item.code;
    }
    return null;
  }
  if (!(item instanceof Error)) return null;
  const code = (item as { code?: unknown }).code;
  // A parse that ran past its deadline. Matched by shape: the class lives in a feature module.
  if (item.name === "ProcessingFailure" && code === "processing_timeout") return code;
  if (typeof code === "string") {
    if (/^08[0-9A-Z]{3}$/.test(code) || TRANSIENT_SQLSTATES.has(code)) return code;
    if (TRANSIENT_NETWORK_CODES.has(code)) return code;
  }
  if (item.message === POOL_CONNECT_TIMEOUT_MESSAGE) return "pool_connect_timeout";
  return null;
}

/**
 * Classifies a failure by the innermost error that explains it: wrappers such as a parse failure
 * keep the provider's, the database's or the object store's error as their cause.
 */
export function classifyFailure(error: unknown): ClassifiedFailure {
  for (const item of causeChain(error)) {
    if (item instanceof AppError && CONFIGURATION_CODES.has(item.code)) {
      return { kind: "configuration", code: item.code, retryAfterMs: null };
    }
    const code = transientCode(item);
    if (code != null) {
      const retryAfter = item instanceof AppError ? item.details?.retryAfterMs : undefined;
      return {
        kind: "transient",
        code,
        retryAfterMs: typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : null,
      };
    }
  }
  return { kind: "permanent", code: findAppErrorCode(error), retryAfterMs: null };
}

const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;
/** The longest a provider's Retry-After is honoured; a run is not parked for hours on its word. */
export const RETRY_AFTER_MAX_MS = 15 * 60_000;

/**
 * How long to wait before the next attempt after the given one failed: a random delay up to 2s,
 * 8s, 32s, then a minute ("full jitter", so work that failed together does not retry together),
 * and at least as long as the provider asked, up to 15 minutes.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterMs: number | null = null,
  random: () => number = Math.random
): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 4 ** Math.max(0, attempt - 1));
  const backoff = Math.round(random() * ceiling);
  return Math.max(Math.min(retryAfterMs ?? 0, RETRY_AFTER_MAX_MS), backoff);
}
