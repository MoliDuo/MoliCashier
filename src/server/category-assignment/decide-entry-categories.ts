import "server-only";
import { generateStructured } from "@/lib/ai/structured";
import {
  buildCategoryAssignmentDocumentMessage,
  buildCategoryAssignmentPrompt,
  categoryAssignmentResponseSchema,
  resolveCategoryAssignmentDecisions,
  type CategoryAssignmentCandidate,
  type CategoryAssignmentDocumentGroup,
} from "@/modules/ledger/domain/category-assignment-protocol";
import { AI_CATEGORY_REQUEST_TIMEOUT_MS } from "@/config/tuning";

/**
 * One request block is up to 50 rows, one decision each, and every decision now
 * carries a short reason ahead of its index, so the room has to hold the notes too.
 */
const MAX_TOKENS = 6000;
/** Batch assignment is a judgement call, not a creative one. */
const TEMPERATURE = 0.1;

/**
 * Places entries into one of a caller-chosen set of categories. A comparison
 * against candidates, not an entry edit: the caller persists the decisions.
 */
export async function decideEntryCategories(input: {
  candidates: readonly CategoryAssignmentCandidate[];
  group: CategoryAssignmentDocumentGroup;
  /** Encoded evidence for this document; empty for a text-only submission. */
  images: readonly { dataUrl: string }[];
  customPrompt?: string;
  signal?: AbortSignal;
}): Promise<{
  decisions: readonly { ledgerEntryId: string; categoryId: string }[];
  confirmedCount: number;
}> {
  const prompt = buildCategoryAssignmentPrompt({
    candidates: input.candidates,
    ...(input.customPrompt == null ? {} : { customPrompt: input.customPrompt }),
  });
  const response = await generateStructured({
    task: "category-assignment",
    schema: categoryAssignmentResponseSchema,
    system: prompt,
    messages: [
      {
        role: "user",
        content: buildCategoryAssignmentDocumentMessage({
          group: input.group,
          images: input.images,
        }),
      },
    ],
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    maxAttempts: 1,
    timeoutMs: AI_CATEGORY_REQUEST_TIMEOUT_MS,
  });
  return resolveCategoryAssignmentDecisions({
    subjects: input.group.subjects,
    candidates: input.candidates,
    response,
  });
}
