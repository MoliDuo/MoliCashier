import { withLedgerAccess } from "../access";
import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";
import { toCategoryAssignmentJobDto } from "@/modules/ledger/server/category-assignment-job-dto";
import type {
  CategoryAssignmentEntryStatesDto,
  CategoryAssignmentResultPageDto,
} from "@/modules/ledger/contracts";
import {
  listCategoryAssignmentEntryStates,
  listCategoryAssignmentResults,
} from "@/server/category-assignment/assignments";
import { getLatestCategoryAssignmentJob } from "@/server/category-assignment/jobs";

/**
 * The ledger's most recent run, running or finished. Read through the session
 * query route rather than the action queue, which is why it lives here rather
 * than beside the start action.
 */
export const getCategoryAssignmentJobAction = withLedgerAccess(
  async (): Promise<CategoryAssignmentJobDto | null> => {
    const job = await getLatestCategoryAssignmentJob();
    return job == null ? null : toCategoryAssignmentJobDto(job);
  }
);

export const getCategoryAssignmentResultsAction = withLedgerAccess(
  async (input: {
    jobId: string;
    cursor?: number;
    limit?: number;
  }): Promise<CategoryAssignmentResultPageDto> => listCategoryAssignmentResults(input)
);

export const getCategoryAssignmentEntryStatesAction = withLedgerAccess(
  async (input: { jobId: string }): Promise<CategoryAssignmentEntryStatesDto> =>
    listCategoryAssignmentEntryStates(input)
);
