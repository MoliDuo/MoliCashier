import { type NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { authenticateServiceCredential } from "@/modules/ledger/server/service-credentials";
import type { AuthenticatedServiceCredential } from "@/modules/ledger/contracts";
import { RateLimitedError, UnauthorizedError } from "@/lib/errors";
import { getErrorStatusCode, toSanitizedErrorResponse } from "@/lib/error-handlers";
import { logger } from "@/lib/logger";

interface ApiV1Context {
  credential: AuthenticatedServiceCredential;
  request: NextRequest;
  requestId: string;
}

/**
 * Request-level metrics collected by a route handler. Never contains the
 * bearer key, image content, base64 payloads, or raw client identifiers.
 */
export interface ApiV1RequestMetrics {
  requestBytes: number;
  imageCount: number;
  decodedBytes: number;
  stages: Record<string, number>;
}

interface ApiV1RouteResult {
  response: NextResponse;
  metrics?: ApiV1RequestMetrics;
}

interface HandleApiV1RouteOptions {
  logContext: string;
  handler: (context: ApiV1Context) => Promise<ApiV1RouteResult>;
}

/**
 * Parse a case-insensitive Bearer token. The header must contain exactly one
 * non-whitespace token after the scheme; anything else (missing header, empty
 * token, trailing non-whitespace content) returns null and is rejected with
 * 401 by the caller.
 */
function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader == null) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(authHeader);
  return match?.[1] ?? null;
}

export async function handleApiV1Route(
  request: NextRequest,
  { logContext, handler }: HandleApiV1RouteOptions
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const stages: Record<string, number> = {};
  try {
    // 1. Case-insensitive Bearer parsing. Missing header, empty token, or
    //    trailing non-whitespace content is rejected without touching the DB.
    const token = getBearerToken(request);
    if (token == null) {
      throw new UnauthorizedError("Missing or invalid Authorization header");
    }

    // 2. Authenticate the credential.
    const authStart = performance.now();
    const credential = await authenticateServiceCredential(token);
    stages.credentialAuthMs = Math.round(performance.now() - authStart);

    if (credential == null) {
      throw new UnauthorizedError("Invalid Service Credential");
    }

    const result = await handler({ credential, request, requestId });
    const response = result.response;
    response.headers.set("X-Request-Id", requestId);
    response.headers.set("Cache-Control", "private, no-store");
    logger.info(
      {
        requestId,
        logContext,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        requestBytes: result.metrics?.requestBytes,
        imageCount: result.metrics?.imageCount,
        decodedBytes: result.metrics?.decodedBytes,
        stages: { ...result.metrics?.stages, ...stages },
      },
      "api/v1 request completed"
    );
    return response;
  } catch (error) {
    const failure =
      error instanceof ApiV1HandlerFailure ? error : { cause: error, metrics: undefined };
    // Build the sanitized response exactly once and reuse the same projection
    // for logging, so the correlation ID is generated a single time.
    const sanitized = toSanitizedErrorResponse(failure.cause);
    const status = getErrorStatusCode(failure.cause);
    const response = NextResponse.json(sanitized, {
      status,
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId },
    });
    if (failure.cause instanceof UnauthorizedError) {
      response.headers.set("WWW-Authenticate", "Bearer");
    }
    if (failure.cause instanceof RateLimitedError) {
      response.headers.set("Retry-After", String(failure.cause.retryAfterSeconds));
    }
    logger[status < 500 ? "warn" : "error"](
      {
        requestId,
        logContext,
        status,
        errorCode: sanitized.error.code,
        durationMs: Math.round(performance.now() - startedAt),
        requestBytes: failure.metrics?.requestBytes,
        imageCount: failure.metrics?.imageCount,
        decodedBytes: failure.metrics?.decodedBytes,
        stages: { ...failure.metrics?.stages, ...stages },
      },
      "api/v1 request failed"
    );
    return response;
  }
}

/**
 * Carries partial request metrics from a failed handler to the route helper
 * so failure logs still record request bytes and per-stage timing without
 * leaking request contents.
 */
export class ApiV1HandlerFailure extends Error {
  readonly cause: unknown;
  readonly metrics: ApiV1RequestMetrics | undefined;

  constructor(cause: unknown, metrics?: ApiV1RequestMetrics) {
    super("API v1 route handler failed", { cause });
    this.name = "ApiV1HandlerFailure";
    this.cause = cause;
    this.metrics = metrics;
  }
}
