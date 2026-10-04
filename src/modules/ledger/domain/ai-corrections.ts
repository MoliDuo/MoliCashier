/**
 * What the owner changed in what the AI wrote, as differences the daily
 * learning step can read. Pure functions only: the server reads the rows and
 * writes what these return.
 *
 * Only a category, an item name and a document title are learned from. An
 * amount, a currency, a note or a deletion is a fact about one receipt, not a
 * preference.
 */

export type AiCorrectionField = "category" | "item_name" | "title";

/** The stored value of "no category", since a correction's values are never null. */
export const UNCATEGORIZED_VALUE = "";

export interface CorrectableEntry {
  id: string;
  categoryId: string | null;
  itemName: string;
  amount: string;
  currency: string | null;
}

export interface PreviousCorrectableEntry extends CorrectableEntry {
  /** True when the AI wrote the entry; an entry the owner added is not corrected. */
  extracted: boolean;
}

/** One edit as it happened: the value before it and the value after. */
export interface AiCorrectionChange {
  subjectId: string;
  field: AiCorrectionField;
  before: string;
  after: string;
  /** Context for the learning step; never a field it may change. */
  context: { itemName: string | null; amount: string | null; currency: string | null };
}

export interface StoredCorrection {
  beforeValue: string;
  afterValue: string;
}

export type CorrectionWrite =
  | { kind: "upsert"; beforeValue: string; afterValue: string }
  | { kind: "delete" }
  | { kind: "none" };

/**
 * The edits one write made to the entries and title the AI produced.
 * `categoryName` turns an id into the name that is stored, so a correction
 * outlives a deleted category.
 */
export function diffAiCorrections(input: {
  previousEntries: readonly PreviousCorrectableEntry[];
  nextEntries: readonly CorrectableEntry[];
  categoryName: (categoryId: string | null) => string;
  document?: { id: string; previousTitle: string | null; nextTitle: string | undefined };
  /** Whether the AI wrote the document's title: it has entries the AI wrote. */
  titleFromAi?: boolean;
}): AiCorrectionChange[] {
  const changes: AiCorrectionChange[] = [];
  const nextById = new Map(input.nextEntries.map((entry) => [entry.id, entry]));
  for (const previous of input.previousEntries) {
    const next = nextById.get(previous.id);
    if (next == null || !previous.extracted) continue;
    const context = {
      itemName: next.itemName,
      amount: next.amount,
      currency: next.currency,
    };
    if (previous.categoryId !== next.categoryId) {
      changes.push({
        subjectId: previous.id,
        field: "category",
        before: input.categoryName(previous.categoryId),
        after: input.categoryName(next.categoryId),
        context,
      });
    }
    if (previous.itemName !== next.itemName) {
      changes.push({
        subjectId: previous.id,
        field: "item_name",
        before: previous.itemName,
        after: next.itemName,
        context,
      });
    }
  }
  const document = input.document;
  if (
    document != null &&
    input.titleFromAi === true &&
    document.nextTitle !== undefined &&
    document.nextTitle !== document.previousTitle
  ) {
    changes.push({
      subjectId: document.id,
      field: "title",
      before: document.previousTitle ?? "",
      after: document.nextTitle,
      context: { itemName: null, amount: null, currency: null },
    });
  }
  return changes;
}

/**
 * What to do with the stored correction after one more edit. The stored row
 * keeps the AI's own value as `before`, so a second edit moves only `after`,
 * and an edit back to the AI's value leaves nothing to learn from.
 */
export function nextCorrectionWrite(
  existing: StoredCorrection | null,
  change: Pick<AiCorrectionChange, "before" | "after">
): CorrectionWrite {
  const beforeValue = existing?.beforeValue ?? change.before;
  if (change.after === beforeValue) return existing == null ? { kind: "none" } : { kind: "delete" };
  if (existing != null && existing.afterValue === change.after) return { kind: "none" };
  return { kind: "upsert", beforeValue, afterValue: change.after };
}
