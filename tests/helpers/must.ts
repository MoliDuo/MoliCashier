/**
 * Narrows a value that a test needs to exist: throws a clear error when it is `null` or
 * `undefined` and returns it otherwise, so the test can use it without `?.` or `!`.
 */
export function must<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to exist, got ${String(value)}`);
  }
  return value;
}
