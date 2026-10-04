import { add, compare } from "@/lib/money/decimal";
import { UNCATEGORIZED_KEY } from "../series";
import type { JudgmentRefs } from "./schema";

/** One line of a document, as the AI reads it. */
export interface DigestEntry {
  itemName: string;
  description: string | null;
  categoryId: string | null;
  /** The original currency and amount, and the amount in the main currency. */
  currency: string;
  amount: string;
  converted: string;
}

export interface DigestDocument {
  id: string;
  date: string;
  title: string | null;
  /** What the owner typed or pasted when recording it. */
  inputText: string | null;
  entries: DigestEntry[];
}

export interface DigestCategory {
  id: string;
  name: string;
  description: string | null;
}

/** What the statistical model made of the same history, handed over as a first pass. */
export interface DigestReference {
  lifeChange: { date: string; dailyBefore: number; dailyAfter: number } | null;
  largeFrom: number | null;
  bills: { label: string; key: string; amount: number; cadence: string; next: string | null }[];
  /** This month's outlook per category key. */
  outlook: { key: string; p10: number; p50: number; p90: number }[];
}

export interface DigestInput {
  asOf: string;
  mainCurrency: string;
  categories: readonly DigestCategory[];
  /** Every document recorded on or before `asOf`, in any order. */
  documents: readonly DigestDocument[];
  reference: DigestReference | null;
  maxChars: number;
  inputTextChars: number;
}

export interface Digest {
  text: string;
  refs: JudgmentRefs;
  /** The first day the digest covers; null with no documents. */
  earliest: string | null;
  /** How many documents went in whole, as a summary line, folded into day totals, or not at all. */
  levels: { detailed: number; summarized: number; folded: number; dropped: number };
}

/**
 * How much of a document the AI sees: everything, everything but the
 * original input, one summary line, or only its share of a day's total.
 */
type Level = 0 | 1 | 2 | 3;

interface Prepared {
  ref: string;
  document: DigestDocument;
  total: string;
  /** The category most of its money went to. */
  categoryRef: string;
  large: boolean;
  level: Level;
}

const FOLDED_HEADING =
  "\n## Earlier everyday spending, folded into day totals (date category total xcount)\n";
const DOCUMENTS_HEADING =
  "\n## Documents (ref date title =total; lines: name | category | amount in main currency)\n";
/** Room kept for the line saying how many older documents were left out. */
const DROPPED_NOTE_ROOM = 64;

function money(value: number | string): string {
  return Number(value).toFixed(2);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/**
 * The ledger as compact text for the AI analyst, with short references in
 * place of ids. Everything recorded goes in while it fits `maxChars`; past
 * that, the oldest documents give way first — their original input, then
 * their lines, then the documents themselves, folded into day-by-category
 * totals — and a large purchase always keeps its lines. Only past all of that
 * are the oldest days left out.
 */
export function buildJudgmentDigest(input: DigestInput): Digest {
  const categoryRefs = new Map<string, string>([[UNCATEGORIZED_KEY, "c0"]]);
  input.categories.forEach((category, index) => categoryRefs.set(category.id, `c${index + 1}`));
  const categoryRef = (categoryId: string | null) =>
    categoryRefs.get(categoryId ?? UNCATEGORIZED_KEY) ?? "c0";

  const sorted = [...input.documents]
    .filter((document) => document.date <= input.asOf && document.entries.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const prepared: Prepared[] = sorted.map((document, index) => {
    const byCategory = new Map<string, string>();
    let total = "0";
    for (const entry of document.entries) {
      total = add(total, entry.converted);
      const ref = categoryRef(entry.categoryId);
      byCategory.set(ref, add(byCategory.get(ref) ?? "0", entry.converted));
    }
    const main = [...byCategory].sort((a, b) => compare(b[1], a[1]))[0]![0];
    return {
      ref: `d${index + 1}`,
      document,
      total,
      categoryRef: byCategory.size > 1 ? `${main}+` : main,
      large: input.reference?.largeFrom != null && Number(total) >= input.reference.largeFrom,
      level: 0,
    };
  });

  const render = (item: Prepared, level: Level): string => {
    if (level === 3) return "";
    const { document } = item;
    const title = oneLine(document.title ?? document.entries[0]!.itemName, 60);
    const head = `${item.ref} ${document.date} ${title} =${money(item.total)}`;
    if (level === 2) return `${head} ${item.categoryRef}\n`;
    const lines = [head];
    if (level === 0 && document.inputText != null && document.inputText.trim() !== "") {
      lines.push(`  input: ${oneLine(document.inputText, input.inputTextChars)}`);
    }
    for (const entry of document.entries) {
      const name = oneLine(
        entry.description == null || entry.description.trim() === ""
          ? entry.itemName
          : `${entry.itemName}; ${entry.description}`,
        80
      );
      const original =
        entry.currency === input.mainCurrency ? "" : ` (${entry.currency} ${money(entry.amount)})`;
      lines.push(
        `  - ${name} | ${categoryRef(entry.categoryId)} | ${money(entry.converted)}${original}`
      );
    }
    return `${lines.join("\n")}\n`;
  };

  const header = renderHeader(input, categoryRefs);
  const lengths = prepared.map((item) => render(item, 0).length);
  // The headings are counted from the start, whether or not anything is folded or dropped.
  let length =
    header.length +
    FOLDED_HEADING.length +
    DOCUMENTS_HEADING.length +
    DROPPED_NOTE_ROOM +
    lengths.reduce((sum, value) => sum + value, 0);
  const setLevel = (index: number, level: Level) => {
    const item = prepared[index]!;
    const next = render(item, level).length;
    length += next - lengths[index]!;
    lengths[index] = next;
    item.level = level;
  };

  // Oldest first: drop the original input, then the lines of all but the large purchases.
  for (const level of [1, 2] as const) {
    for (let index = 0; index < prepared.length && length > input.maxChars; index++) {
      if (level === 2 && prepared[index]!.large) continue;
      setLevel(index, level);
    }
  }

  // Then fold whole days of everyday purchases into totals per category.
  const folded = new Map<string, Map<string, { total: string; count: number }>>();
  const foldedLength = (date: string) =>
    [...(folded.get(date) ?? new Map<string, { total: string; count: number }>())]
      .map(([ref, sum]) => `${date} ${ref} ${money(sum.total)} x${sum.count}\n`.length)
      .reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < prepared.length && length > input.maxChars;) {
    const date = prepared[index]!.document.date;
    const before = foldedLength(date);
    for (; index < prepared.length && prepared[index]!.document.date === date; index++) {
      const item = prepared[index]!;
      if (item.large) continue;
      const day = folded.get(date) ?? new Map<string, { total: string; count: number }>();
      folded.set(date, day);
      const ref = item.categoryRef.replace(/\+$/, "");
      const sum = day.get(ref) ?? { total: "0", count: 0 };
      day.set(ref, { total: add(sum.total, item.total), count: sum.count + 1 });
      setLevel(index, 3);
    }
    length += foldedLength(date) - before;
  }

  // Last of all, leave the oldest days out.
  let firstKept = 0;
  while (firstKept < prepared.length && length > input.maxChars) {
    const date = prepared[firstKept]!.document.date;
    length -= foldedLength(date);
    folded.delete(date);
    for (
      ;
      firstKept < prepared.length && prepared[firstKept]!.document.date === date;
      firstKept++
    ) {
      length -= lengths[firstKept]!;
    }
  }

  const kept = prepared.slice(firstKept);
  const foldedText = [...folded]
    .flatMap(([date, day]) =>
      [...day].map(([ref, sum]) => `${date} ${ref} ${money(sum.total)} x${sum.count}\n`)
    )
    .join("");
  const documentText = kept.map((item) => render(item, item.level)).join("");
  const text = [
    header,
    firstKept > 0 ? `(${firstKept} older documents left out for length.)\n` : "",
    foldedText === "" ? "" : FOLDED_HEADING + foldedText,
    DOCUMENTS_HEADING,
    documentText,
  ].join("");

  const documentRefs = new Map<string, string>();
  for (const item of kept) {
    if (item.level !== 3) documentRefs.set(item.ref, item.document.id);
  }
  return {
    text,
    refs: {
      documents: documentRefs,
      categories: new Map([...categoryRefs].map(([key, ref]) => [ref, key])),
    },
    earliest: kept[0]?.document.date ?? null,
    levels: {
      detailed: kept.filter((item) => item.level <= 1).length,
      summarized: kept.filter((item) => item.level === 2).length,
      folded: kept.filter((item) => item.level === 3).length,
      dropped: firstKept,
    },
  };
}

function renderHeader(input: DigestInput, categoryRefs: ReadonlyMap<string, string>): string {
  const monthStart = `${input.asOf.slice(0, 8)}01`;
  const spent = new Map<string, string>();
  for (const document of input.documents) {
    if (document.date < monthStart || document.date > input.asOf) continue;
    for (const entry of document.entries) {
      const ref = categoryRefs.get(entry.categoryId ?? UNCATEGORIZED_KEY) ?? "c0";
      spent.set(ref, add(spent.get(ref) ?? "0", entry.converted));
    }
  }
  const lines = [
    `Today: ${input.asOf}. Main currency: ${input.mainCurrency}. Every amount below is in it unless shown in brackets.`,
    "",
    "## Categories (ref name: description)",
    "c0 (no category)",
    ...input.categories.map(
      (category) =>
        `${categoryRefs.get(category.id)} ${category.name}` +
        (category.description == null || category.description.trim() === ""
          ? ""
          : `: ${oneLine(category.description, 80)}`)
    ),
    "",
    `## Spent this month so far (${monthStart} to ${input.asOf})`,
    spent.size === 0
      ? "nothing yet"
      : [...spent].map(([ref, total]) => `${ref} ${money(total)}`).join(", "),
  ];
  const reference = input.reference;
  if (reference != null) {
    const ref = (key: string) => categoryRefs.get(key) ?? "c0";
    lines.push("", "## What a statistical model made of it (a first pass; overrule it freely)");
    lines.push(
      reference.lifeChange == null
        ? "- no change in the way of spending detected"
        : `- spending changed from ${reference.lifeChange.date}: about ${money(reference.lifeChange.dailyBefore)} a day before, ${money(reference.lifeChange.dailyAfter)} since`
    );
    if (reference.largeFrom != null) {
      lines.push(
        `- treats any single purchase of ${money(reference.largeFrom)} or more as one-off`
      );
    }
    for (const bill of reference.bills) {
      lines.push(
        `- recurring: ${oneLine(bill.label, 40)} ${ref(bill.key)} ${money(bill.amount)} ${bill.cadence}` +
          (bill.next == null ? "" : `, next ${bill.next}`)
      );
    }
    if (reference.outlook.length > 0) {
      lines.push(
        `- whole-month outlook P10/P50/P90: ${reference.outlook
          .map(
            (row) =>
              `${ref(row.key)} ${Math.round(row.p10)}/${Math.round(row.p50)}/${Math.round(row.p90)}`
          )
          .join(", ")}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
