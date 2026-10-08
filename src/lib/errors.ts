/**
 * Base application error class
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

/**
 * A record or key was pointed at a book it cannot use: unknown, archived, or
 * belonging to another ledger. Distinct from `ConflictError` so callers can tell
 * "this book is not available" apart from a ledger-level conflict such as the
 * active-credential cap, which is what an indistinguishable status code used to
 * conflate.
 */
export class BookUnavailableError extends AppError {
  constructor(message: string = "Book is not available") {
    super(message, "BOOK_UNAVAILABLE", 409);
  }
}

/**
 * A server action that answered with `{ ok: false, code }`, raised again on the
 * client so a mutation's error path can branch on the stable code. Never thrown
 * on the server: an action's thrown error loses its code in production.
 */
export class ActionRefusedError<TCode extends string = string> extends Error {
  constructor(public readonly code: TCode) {
    super(code);
    this.name = "ActionRefusedError";
  }
}

/** The code an action refused with, or undefined for any other failure. */
export function refusalCode<TCode extends string>(error: unknown): TCode | undefined {
  return error instanceof ActionRefusedError ? (error.code as TCode) : undefined;
}
