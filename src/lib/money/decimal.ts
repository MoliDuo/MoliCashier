/**
 * Shared decimal arithmetic using decimal.js.
 *
 * All monetary values are canonical non-exponent decimal strings.
 * All public functions accept decimal strings and return decimal strings
 * (except `compare`, `allocate`, and `isValidDecimal` which have different
 * return types).
 */

import Decimal from "decimal.js";

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const DECIMAL_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Amounts are stored as numeric(21,3), which leaves 18 digits before the point. */
export const MAX_AMOUNT_INTEGER_DIGITS = 18;

/**
 * What a half-typed amount field means: "1." is 1, ".5" is 0.5, "007" is 7, and
 * a lone "-" or "." means nothing. Anything else that is not a plain decimal
 * also means nothing, so it is never passed on as a filter the URL would drop.
 */
export function normalizeDecimalInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (match == null) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  const candidate = `${sign}${integer}${fraction === "" ? "" : `.${fraction}`}`;
  return DECIMAL_STRING_PATTERN.test(candidate) ? candidate : null;
}

function toCanonical(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

/**
 * Safely parse a money value. Accepts strings, numbers, or Decimal instances.
 * Throws if the input is not a valid finite decimal.
 */
export function parse(input: string | number | Decimal): Decimal {
  return new MoneyDecimal(input);
}

/**
 * Normalize a decimal string to its canonical non-exponent form.
 * For example, "1.2300" -> "1.23" and "1e2" -> "100".
 */
export function normalize(value: string): string {
  return toCanonical(new MoneyDecimal(value));
}

/** Maximum total digits allowed in a canonical decimal string. */
const MAX_DIGITS = 1000;

/**
 * Returns true if the string is a valid finite decimal representable at
 * database precision (max 1000 digits). Rejects exponent notation.
 */
export function isValidDecimal(value: string): boolean {
  if (!DECIMAL_STRING_PATTERN.test(value)) return false;

  try {
    const d = new MoneyDecimal(value);
    if (!d.isFinite()) return false;

    // Check total digit count (excluding sign and decimal point)
    const normalized = d.toFixed();
    const digits = normalized.replace(/[^0-9]/g, "");
    return digits.length <= MAX_DIGITS;
  } catch {
    return false;
  }
}

/**
 * Add two decimal strings.
 */
export function add(a: string, b: string): string {
  return toCanonical(new MoneyDecimal(a).plus(b));
}

/**
 * Multiply two decimal strings.
 */
export function multiply(a: string, b: string): string {
  return toCanonical(new MoneyDecimal(a).times(b));
}

/**
 * Divide a by b.
 */
export function divide(a: string, b: string): string {
  return toCanonical(new MoneyDecimal(a).dividedBy(b).toDecimalPlaces(20));
}

/**
 * Compare two decimal strings. Returns -1 (a < b), 0 (a === b), or 1 (a > b).
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const result = new MoneyDecimal(a).comparedTo(b);
  if (result < 0) return -1;
  if (result > 0) return 1;
  return 0;
}

/**
 * Return the absolute value of a decimal string.
 */
export function abs(value: string): string {
  return toCanonical(new MoneyDecimal(value).abs());
}

/**
 * Round a decimal string to the given number of decimal places using half-up rounding.
 */
export function round(value: string, decimals: number): string {
  const rounded = new MoneyDecimal(value).toDecimalPlaces(decimals);
  return rounded.isZero() ? "0" : rounded.toFixed(decimals);
}

/**
 * Deterministic remainder distribution: allocate a decimal amount across
 * ratios so that the sum of the allocated parts equals the source amount exactly.
 *
 * The last part absorbs any rounding remainder.
 *
 * @param value - The source amount as a decimal string.
 * @param ratios - An array of non-negative ratio numbers. Does not need to sum to 1.
 * @param decimals - Number of decimal places for rounding (default 2).
 * @returns An array of allocated decimal strings whose sum equals the input value.
 */
export function allocate(value: string, ratios: number[], decimals = 2): string[] {
  if (ratios.length === 0) return [];

  const decimalValue = new MoneyDecimal(value);
  const totalRatio = ratios.reduce((sum, r) => sum + r, 0);

  if (totalRatio === 0) {
    // Equal split when all ratios are zero (last absorbs rounding remainder)
    const perPart = decimalValue.dividedBy(ratios.length);
    const results: string[] = [];
    let distributed = new MoneyDecimal(0);
    for (let i = 0; i < ratios.length - 1; i++) {
      const rounded = perPart.toFixed(decimals, MoneyDecimal.ROUND_HALF_UP);
      results.push(rounded);
      distributed = distributed.plus(rounded);
    }
    results.push(decimalValue.minus(distributed).toFixed(decimals, MoneyDecimal.ROUND_HALF_UP));
    return results;
  }

  let distributed = new MoneyDecimal(0);
  const results: string[] = [];

  for (let i = 0; i < ratios.length - 1; i++) {
    const share = decimalValue.times(ratios[i]!).dividedBy(totalRatio);
    const rounded = share.toFixed(decimals, MoneyDecimal.ROUND_HALF_UP);
    results.push(rounded);
    distributed = distributed.plus(rounded);
  }

  // Last part absorbs rounding remainder
  const remainder = decimalValue.minus(distributed);
  results.push(remainder.toFixed(decimals, MoneyDecimal.ROUND_HALF_UP));

  return results;
}
