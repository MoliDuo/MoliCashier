import { z } from "zod";
import { addCivilDays } from "@/modules/ledger/domain/period";

/**
 * The AI analyst's contract: what it answers, and how the answer, written
 * against the short references the digest gave it, becomes a judgment
 * against the ledger's own ids. The AI only judges — which purchases are not
 * everyday ones, what is coming, how much each category's everyday spending
 * runs to a day, how life has gone in stretches. Every sum is the code's.
 */

export const JUDGMENT_CADENCES = ["weekly", "monthly", "semester", "yearly", "irregular"] as const;
export type JudgmentCadence = (typeof JUDGMENT_CADENCES)[number];

export const JUDGMENT_TRENDS = ["rising", "falling", "steady"] as const;
export type JudgmentTrend = (typeof JUDGMENT_TRENDS)[number];

/** The longest phase label kept; a longer one is cut. */
const PHASE_LABEL_MAX = 12;
/** The longest label kept for something expected. */
const EXPECTED_LABEL_MAX = 24;

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.number().finite();
// Every list is lenient item by item: a bad item is dropped when the answer is resolved, not the answer.
const item = z.record(z.string(), z.unknown());

export const judgmentResponseSchema = z.object({
  phases: z.array(item).max(40),
  documents: z.array(item).max(2000),
  expected: z.array(item).max(200),
  categories: z.array(item).max(400),
});

export type JudgmentResponse = z.infer<typeof judgmentResponseSchema>;

const phaseSchema = z.object({ from: civilDate, label: z.string().trim().min(1) });
const documentSchema = z.object({
  ref: z.string(),
  kind: z.enum(["one_off", "recurring"]),
  cadence: z.enum(JUDGMENT_CADENCES).nullish(),
});
const expectedSchema = z.object({
  label: z.string().trim().min(1),
  category: z.string().nullish(),
  date: civilDate,
  amount,
  cadence: z.enum(JUDGMENT_CADENCES),
  basis: z.array(z.string()).max(100).default([]),
});
const categorySchema = z.object({
  category: z.string(),
  low: amount,
  mid: amount,
  high: amount,
  trend: z.enum(JUDGMENT_TRENDS),
});

/** A stretch of life, from its first day until the next one begins. */
export interface JudgedPhase {
  from: string;
  label: string;
}

/** A purchase the AI judged not to be everyday spending. */
export interface JudgedDocument {
  documentId: string;
  kind: "one_off" | "recurring";
  cadence: JudgmentCadence | null;
}

/** Something the AI expects after the day it judged. */
export interface JudgedExpected {
  label: string;
  /** The category key, as the series files it. */
  key: string;
  date: string;
  amount: number;
  cadence: JudgmentCadence;
  /** How many past purchases it rests on. */
  seen: number;
}

/** How much a category's everyday spending runs to a day from now on, and which way it is heading. */
export interface JudgedCategory {
  key: string;
  low: number;
  mid: number;
  high: number;
  trend: JudgmentTrend;
}

export interface Judgment {
  phases: JudgedPhase[];
  documents: JudgedDocument[];
  expected: JudgedExpected[];
  categories: JudgedCategory[];
}

/** The short names the digest gave documents and categories, mapped back to ids and category keys. */
export interface JudgmentRefs {
  documents: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
}

/**
 * The answer as a judgment of the day `asOf`, with every item that does not
 * hold up left out: a reference the digest never gave, a date out of range, a
 * negative or non-finite amount. The phases come out in order, one per day;
 * a category's three levels in order, low to high.
 */
export function resolveJudgment(
  response: JudgmentResponse,
  refs: JudgmentRefs,
  window: { earliest: string; asOf: string; expectedDays: number }
): Judgment {
  const parse = <T>(schema: z.ZodType<T>, items: readonly unknown[]): T[] =>
    items.flatMap((value) => {
      const parsed = schema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  const lastExpected = addCivilDays(window.asOf, window.expectedDays);

  const phases = new Map<string, JudgedPhase>();
  for (const phase of parse(phaseSchema, response.phases)) {
    if (phase.from > window.asOf) continue;
    const from = phase.from < window.earliest ? window.earliest : phase.from;
    phases.set(from, { from, label: phase.label.slice(0, PHASE_LABEL_MAX) });
  }

  const documents = new Map<string, JudgedDocument>();
  for (const document of parse(documentSchema, response.documents)) {
    const documentId = refs.documents.get(document.ref);
    if (documentId == null) continue;
    documents.set(documentId, {
      documentId,
      kind: document.kind,
      cadence: document.kind === "recurring" ? (document.cadence ?? "irregular") : null,
    });
  }

  const expected: JudgedExpected[] = [];
  for (const item of parse(expectedSchema, response.expected)) {
    if (item.date <= window.asOf || item.date > lastExpected || !(item.amount > 0)) continue;
    const key = item.category == null ? null : refs.categories.get(item.category);
    if (key == null) continue;
    expected.push({
      label: item.label.slice(0, EXPECTED_LABEL_MAX),
      key,
      date: item.date,
      amount: item.amount,
      cadence: item.cadence,
      seen: new Set(item.basis.filter((ref) => refs.documents.has(ref))).size,
    });
  }
  expected.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const categories = new Map<string, JudgedCategory>();
  for (const category of parse(categorySchema, response.categories)) {
    const key = refs.categories.get(category.category);
    if (key == null) continue;
    const [low, mid, high] = [category.low, category.mid, category.high]
      .map((value) => Math.max(0, value))
      .sort((a, b) => a - b) as [number, number, number];
    categories.set(key, { key, low, mid, high, trend: category.trend });
  }

  return {
    phases: [...phases.values()].sort((a, b) => a.from.localeCompare(b.from)),
    documents: [...documents.values()],
    expected,
    categories: [...categories.values()],
  };
}

/** A stored judgment, read back: the same shape, checked again since the column holds whatever was written. */
export const storedJudgmentSchema: z.ZodType<Judgment> = z.object({
  phases: z.array(z.object({ from: civilDate, label: z.string() })),
  documents: z.array(
    z.object({
      documentId: z.string(),
      kind: z.enum(["one_off", "recurring"]),
      cadence: z.enum(JUDGMENT_CADENCES).nullable(),
    })
  ),
  expected: z.array(
    z.object({
      label: z.string(),
      key: z.string(),
      date: civilDate,
      amount,
      cadence: z.enum(JUDGMENT_CADENCES),
      seen: z.number().int().nonnegative(),
    })
  ),
  categories: z.array(
    z.object({
      key: z.string(),
      low: amount,
      mid: amount,
      high: amount,
      trend: z.enum(JUDGMENT_TRENDS),
    })
  ),
});
