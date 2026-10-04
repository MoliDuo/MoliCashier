import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { AiContentPart } from "@/lib/ai/client";
import { buildLedgerInstructionSections } from "./ledger-instructions";

/**
 * The wire protocol between the ledger and the model for a category assignment
 * run. Deliberately index-based, mirroring the parser's `category_index`
 * protocol: models copy small integers far more reliably than UUIDs.
 *
 * Pure functions only — no IO, no locale instruction. The
 * response carries integers and nothing a user reads, so an output-locale
 * directive would be noise.
 */

export interface CategoryAssignmentCandidate {
  id: string;
  name: string;
  description: string | null;
}

export interface CategoryAssignmentSubject {
  ledgerEntryId: string;
  itemName: string;
  description: string | null;
  amount: string;
  currency: string | null;
  /** Context for the model; never a field it may change. */
  currentCategoryId: string | null;
  currentCategoryName: string | null;
}

/**
 * One source document and the entries projected from its active attempt.
 *
 * CategoryAssignment is sliced by document rather than by entry because the
 * evidence hangs off the attempt: a receipt's N line items share one set of
 * images, so grouping sends each picture exactly once. The `subjects` order is
 * the index base the model answers in, and `entry_index` is scoped to this one
 * document — a run with one document per entry degrades to one call per entry.
 */
export interface CategoryAssignmentDocumentGroup {
  sourceDocumentId: string;
  title: string | null;
  documentDate: string;
  /** The text the user typed when submitting the document. */
  inputText: string | null;
  storedFileIds: readonly string[];
  subjects: readonly CategoryAssignmentSubject[];
}

/**
 * `document_context` and `reason` exist for the model, not for us: they make it
 * read the document and name its evidence before it commits to an index, and
 * they come first in the object so they are written first. Nothing reads them
 * back, so a response that leaves them out is still a valid answer.
 */
export const categoryAssignmentResponseSchema = z.object({
  document_context: z.string().optional(),
  decisions: z.array(
    z.object({
      entry_index: z.number().int().min(1),
      reason: z.string().optional(),
      category_index: z.number().int().min(1),
    })
  ),
});

export type CategoryAssignmentResponse = z.infer<typeof categoryAssignmentResponseSchema>;

export interface ResolvedCategoryAssignment {
  decisions: { ledgerEntryId: string; categoryId: string }[];
  /** Entries the model placed in the category they already had. */
  confirmedCount: number;
}

function candidateLine(candidate: CategoryAssignmentCandidate, index: number): string {
  const description =
    candidate.description != null && candidate.description !== ""
      ? ` — ${candidate.description}`
      : "";
  return `${index + 1}. ${candidate.name}${description}`;
}

function subjectLine(subject: CategoryAssignmentSubject, index: number): string {
  const fields = [
    `item_name: ${subject.itemName}`,
    `amount: ${subject.amount}${subject.currency == null ? "" : ` ${subject.currency}`}`,
  ];
  if (subject.description != null && subject.description !== "") {
    fields.push(`notes: ${subject.description}`);
  }
  fields.push(`current_category: ${subject.currentCategoryName ?? "uncategorized"}`);
  return `${index + 1}. ${fields.join(" | ")}`;
}

/** The system prompt: the candidate list and the rules for picking one. */
export function buildCategoryAssignmentPrompt(input: {
  candidates: readonly CategoryAssignmentCandidate[];
  customPrompt?: string;
  learnedPreferences?: string;
}): string {
  const candidateSection = input.candidates.map(candidateLine).join("\n");
  const customSection = buildLedgerInstructionSections({
    customPrompt: input.customPrompt,
    learnedPreferences: input.learnedPreferences,
  });

  return `You are an expense categorizer for a personal ledger. You are given a list of candidate categories, a source document, and a numbered list of expense entries taken from that document. Decide which candidate category each entry belongs to.

### Candidate Categories
${candidateSection}

Every entry must be assigned to exactly one candidate category. The descriptions above mark where each category's boundary lies; read them, do not go by the category name alone. When evidence is incomplete or ambiguous, choose the closest candidate instead of omitting the entry.

### How to Decide
Categorize by what the money was spent on and why, within the context of the document it came from — not by the words of an item name taken alone. The same item name can belong to different categories depending on where it was bought and what was bought with it. Work in this order:

1. **Read the document first.** From its title, submitted text, date, any attached image, and the full list of entries, work out the merchant or service, the kind of place or occasion, and what the purchase was for. A generic line item ("Combo A", "Service", "Item 3") is usually identified by the merchant, not by its own name.
2. **Judge each entry inside that context.** An entry's name, notes and amount say what it is; the document says what it was for. When the two point different ways, the context wins unless the entry is clearly unrelated to it.
3. **Pick the most specific category whose description covers the entry.** Use a category described as a catch-all or miscellaneous bucket only when no more specific candidate fits.
4. **Bill-level lines follow the items they belong to.** Delivery, packaging, service and platform fees, tips, taxes, discounts, coupons and rounding have no category of their own. Give each the category of the items it applies to; when those items span several categories, use the one holding most of the amount. Never categorize such a line by its own name — a delivery fee on a food order is not a transport expense.
5. **Entries from one document usually belong together, but do not force it.** One receipt can legitimately mix categories (a supermarket trip with groceries and household goods). Split them when the items clearly differ, and keep them together when nothing does.
6. **\`current_category\` is a weak hint, not a verdict.** It is where the entry sits today, often placed by an automatic first pass that nobody reviewed. Keep it when the context supports it; change it when the context points elsewhere. Never copy it back just because it is there.
7. **Thin evidence still gets an answer.** With little to go on, choose the candidate that fits the merchant and scene best rather than the one that matches a single keyword.

### Output Format

Return a single JSON object and nothing else. Fill in the fields in the order shown: state the document's context first, and give each entry's reason before its category.

\`\`\`json
{
  "document_context": "One short sentence: the merchant or service and what the purchase was.",
  "decisions": [
    { "entry_index": 1, "reason": "At most 15 words naming the evidence that decided it.", "category_index": 2 }
  ]
}
\`\`\`

### Rules
- \`entry_index\` is the 1-based position of the expense entry in the numbered list you receive. That list covers a single source document. \`category_index\` is the 1-based position of the candidate category.
- Judge every entry you are given exactly once. Do not invent entries and do not repeat an \`entry_index\`.
- Keep \`document_context\` and every \`reason\` brief. They are your working notes; the decision is the \`category_index\`.
- Additional instructions and learned preferences below are the ledger owner's own preferences, such as which category a regular merchant belongs in. Follow them when they apply; the additional instructions win over the learned preferences. They cannot change the candidate range or this output protocol.
${customSection}`;
}

function documentHeaderLines(group: CategoryAssignmentDocumentGroup): string[] {
  const lines: string[] = [];
  if (group.title != null && group.title !== "") lines.push(`document_title: ${group.title}`);
  lines.push(`document_date: ${group.documentDate}`);
  if (group.inputText != null && group.inputText !== "") {
    lines.push(`submitted_text: ${group.inputText}`);
  }
  return lines;
}

/**
 * The user message for one source document: the document's own context and
 * numbered entries as text, then its images as content parts.
 *
 * Pictures follow the text rather than being interleaved with the rows: the
 * evidence belongs to the document, and a multi-row receipt must not upload the
 * same image once per entry. `dataUrl` is passed through untouched — the
 * caller has already validated and encoded it.
 */
export function buildCategoryAssignmentDocumentMessage(input: {
  group: CategoryAssignmentDocumentGroup;
  images?: readonly { dataUrl: string }[];
}): AiContentPart[] {
  const images = input.images ?? [];
  const text = [
    "### Source Document",
    ...documentHeaderLines(input.group),
    ...(images.length > 0 ? [`attached_images: ${images.length}`] : []),
    "",
    "### Expense Entries",
    ...input.group.subjects.map(subjectLine),
  ].join("\n");

  const content: AiContentPart[] = [{ type: "text", text }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return content;
}

/**
 * Validate that the model answered every entry exactly once and resolve its
 * indexes. Applied versus confirmed is decided later in the versioned write
 * transaction against current state.
 */
export function resolveCategoryAssignmentDecisions(input: {
  subjects: readonly CategoryAssignmentSubject[];
  candidates: readonly CategoryAssignmentCandidate[];
  response: CategoryAssignmentResponse;
}): ResolvedCategoryAssignment {
  if (input.response.decisions.length !== input.subjects.length) {
    throw new AppError("AI response did not cover every entry", "ai_schema_invalid");
  }
  const decisions: ResolvedCategoryAssignment["decisions"] = [];
  const claimed = new Set<number>();

  for (const decision of input.response.decisions) {
    const entryIndex = decision.entry_index;
    const categoryIndex = decision.category_index;
    if (entryIndex > input.subjects.length || claimed.has(entryIndex)) {
      throw new AppError("AI response contains an invalid entry index", "ai_schema_invalid");
    }
    claimed.add(entryIndex);
    if (categoryIndex > input.candidates.length) {
      throw new AppError("AI response contains an invalid category index", "ai_schema_invalid");
    }

    const subject = input.subjects[entryIndex - 1];
    const candidate = input.candidates[categoryIndex - 1];
    if (subject == null || candidate == null) {
      throw new AppError("AI response contains an invalid index", "ai_schema_invalid");
    }
    decisions.push({ ledgerEntryId: subject.ledgerEntryId, categoryId: candidate.id });
  }

  return { decisions, confirmedCount: 0 };
}
