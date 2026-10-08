"use server";
import { AppError, ValidationError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";
import { requestBackgroundWork } from "@/server/background/wake";
import type {
  CategoryAssignmentCandidateSnapshot,
  CategoryAssignmentMode,
  CategoryAssignmentJobDto,
  StartCategoryAssignmentErrorCode,
  StartCategoryAssignmentInput,
  StartCategoryAssignmentResult,
} from "@/modules/ledger/contracts";
import {
  parseCancelCategoryAssignmentInput,
  parseRetryCategoryAssignmentInput,
  parseStartCategoryAssignmentInput,
} from "../contract-schemas";
import { toCategoryAssignmentJobDto } from "@/modules/ledger/server/category-assignment-job-dto";
import { withLedgerAction } from "../action-access";
import { listCategories } from "../server/categories";
import { getLedgerSettings } from "../server/settings";
import {
  cancelCategoryAssignment,
  resolveLatestConflictSelection,
  retryCategoryAssignmentFailures,
  startCategoryAssignment,
} from "@/server/category-assignment/commands";
import { getCategoryAssignmentJob } from "@/server/category-assignment/reads";

async function validateMode(
  mode: CategoryAssignmentMode
): Promise<CategoryAssignmentCandidateSnapshot[]> {
  const categories = await listCategories();
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ids =
    mode.kind === "ai"
      ? mode.candidateCategoryIds
      : mode.kind === "assign"
        ? [mode.categoryId]
        : [];
  if (!ids.every((id) => byId.has(id))) {
    throw new ValidationError("Category assignment categories must belong to this ledger");
  }
  return mode.kind === "ai"
    ? ids.map((id) => {
        const category = byId.get(id)!;
        return { id: category.id, name: category.name, description: category.description };
      })
    : [];
}

async function loadJob(jobId: string): Promise<CategoryAssignmentJobDto> {
  const job = await getCategoryAssignmentJob({ jobId });
  if (job == null) throw new ValidationError("Category assignment job was not found");
  return toCategoryAssignmentJobDto(job);
}

async function start(
  input: StartCategoryAssignmentInput,
  retryOfJobId?: string
): Promise<CategoryAssignmentJobDto> {
  const candidates = await validateMode(input.mode);
  const settings = await getLedgerSettings();
  const job = await startCategoryAssignment({
    requestKey: input.requestKey,
    mode: input.mode,
    ledgerEntryIds: input.ledgerEntryIds,
    candidates,
    customPrompt: settings?.aiCustomPrompt || null,
    learnedPreferences: settings?.aiLearnedPreferences || null,
    ...(retryOfJobId == null ? {} : { retryOfJobId }),
  });
  // The reply describes the job as it was submitted; the worker starts it after.
  const submitted = await loadJob(job.id);
  requestBackgroundWork();
  return submitted;
}

/**
 * A production browser sees a thrown action error only as a generic message,
 * so the refusals the page explains come back as codes.
 */
function toStartCategoryAssignmentErrorCode(error: unknown): StartCategoryAssignmentErrorCode {
  if (!(error instanceof AppError)) return "unexpected";
  switch (error.code) {
    case "CONFLICT":
      return "busy";
    case "VALIDATION_ERROR":
      return "invalid";
    default:
      return "unexpected";
  }
}

/**
 * Starts a run over the selected entries in one call; replaying the same
 * request key returns the run it started.
 */
export const startCategoryAssignmentAction = withLedgerAction(
  async (input: StartCategoryAssignmentInput): Promise<StartCategoryAssignmentResult> => {
    try {
      return { ok: true, job: await start(parseStartCategoryAssignmentInput(input)) };
    } catch (error) {
      const code = toStartCategoryAssignmentErrorCode(error);
      if (code === "unexpected") logError("category-assignment:start", error);
      return { ok: false, code };
    }
  }
);

export const cancelCategoryAssignmentAction = withLedgerAction(async (input: { jobId: string }) => {
  const validated = parseCancelCategoryAssignmentInput(input);
  await cancelCategoryAssignment({ jobId: validated.jobId });
  return loadJob(validated.jobId);
});

export const retryCategoryAssignmentFailuresAction = withLedgerAction(
  async (input: { jobId: string; requestKey: string }) => {
    const validated = parseRetryCategoryAssignmentInput(input);
    const retry = await retryCategoryAssignmentFailures({
      ...validated,
    });
    const submitted = await loadJob(retry.id);
    requestBackgroundWork();
    return submitted;
  }
);

export const retryCategoryAssignmentLatestAction = withLedgerAction(
  async (input: { jobId: string; requestKey: string }) => {
    const validated = parseRetryCategoryAssignmentInput(input);
    const latest = await resolveLatestConflictSelection({
      jobId: validated.jobId,
    });
    return start(
      {
        requestKey: validated.requestKey,
        mode: latest.mode,
        ledgerEntryIds: latest.ledgerEntryIds,
      },
      latest.retryOfJobId
    );
  }
);
