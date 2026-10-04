/**
 * Scoring for the parse task: pure functions over what the production pipeline
 * returned and what the annotation expects.
 *
 * A case passes when the outcome is right and, for a successful document, the
 * total per (currency, category) matches. Totals rather than entries because a
 * receipt can legitimately be split differently (an item and its fee folded or
 * not) without the ledger being wrong. Entry precision and recall are reported
 * beside it so a pass that rests on a lucky split is still visible.
 */
import Decimal from "decimal.js";
import { roundToCurrency } from "@/lib/money/currency-precision";
import type { ParseExpect } from "../../lib/schema";
import type { Score } from "../types";

/** The pipeline's answer reduced to what is scored, categories already named. */
export interface ParsedOutput {
  outcome: "success" | "invalid";
  entries: { amount: string; currency: string | null; category: string | null }[];
}

interface Normalized {
  currency: string;
  category: string | null;
  amount: string;
}

function normalize(entry: {
  amount: string;
  currency: string | null;
  category: string | null;
}): Normalized {
  const currency = entry.currency ?? "";
  return {
    currency,
    category: entry.category,
    amount: roundToCurrency(entry.amount, currency || "CNY"),
  };
}

function entryKey(entry: Normalized): string {
  return `${entry.currency}|${entry.category ?? ""}|${entry.amount}`;
}

function totalsBy(entries: Normalized[], key: (entry: Normalized) => string): Map<string, string> {
  const sums = new Map<string, Decimal>();
  for (const entry of entries) {
    const bucket = key(entry);
    sums.set(bucket, (sums.get(bucket) ?? new Decimal(0)).plus(entry.amount));
  }
  // Zero buckets (an item and its equal discount) carry no information.
  return new Map(
    [...sums].filter(([, sum]) => !sum.isZero()).map(([bucket, sum]) => [bucket, sum.toFixed()])
  );
}

function sameTotals(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [bucket, total] of a) if (b.get(bucket) !== total) return false;
  return true;
}

function describeDifference(
  label: string,
  expected: Map<string, string>,
  actual: Map<string, string>
): string[] {
  const notes: string[] = [];
  for (const bucket of new Set([...expected.keys(), ...actual.keys()])) {
    const want = expected.get(bucket) ?? "0";
    const got = actual.get(bucket) ?? "0";
    if (want !== got) notes.push(`${label} ${bucket}: expected ${want}, got ${got}`);
  }
  return notes;
}

/** Multiset overlap of two entry lists, by (currency, category, amount). */
function matchedCount(expected: Normalized[], actual: Normalized[]): number {
  const remaining = new Map<string, number>();
  for (const entry of expected) {
    const key = entryKey(entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  let matched = 0;
  for (const entry of actual) {
    const key = entryKey(entry);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      matched += 1;
    }
  }
  return matched;
}

export function scoreParse(expect: ParseExpect, output: ParsedOutput): Score {
  const expected = expect.entries.map(normalize);
  const actual = output.entries.map(normalize);

  const outcomeOk = expect.outcome === output.outcome;
  const expectedByCurrency = totalsBy(expected, (entry) => entry.currency);
  const actualByCurrency = totalsBy(actual, (entry) => entry.currency);
  const expectedByCategory = totalsBy(
    expected,
    (entry) => `${entry.currency}|${entry.category ?? ""}`
  );
  const actualByCategory = totalsBy(actual, (entry) => `${entry.currency}|${entry.category ?? ""}`);

  const currencyOk = sameTotals(expectedByCurrency, actualByCurrency);
  const categoryOk = sameTotals(expectedByCategory, actualByCategory);

  const matched = matchedCount(expected, actual);
  const precision = actual.length === 0 ? 1 : matched / actual.length;
  const recall = expected.length === 0 ? 1 : matched / expected.length;

  const notes: string[] = [];
  if (!outcomeOk) notes.push(`outcome: expected ${expect.outcome}, got ${output.outcome}`);
  else if (expect.outcome === "success") {
    notes.push(...describeDifference("total", expectedByCategory, actualByCategory));
  }

  return {
    pass: outcomeOk && (expect.outcome === "invalid" || categoryOk),
    metrics: {
      outcome: outcomeOk ? 1 : 0,
      currencyTotals: currencyOk ? 1 : 0,
      categoryTotals: categoryOk ? 1 : 0,
      entryPrecision: precision,
      entryRecall: recall,
    },
    notes,
  };
}
