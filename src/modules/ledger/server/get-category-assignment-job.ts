import "server-only";
import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";
import { toCategoryAssignmentJobDto } from "@/modules/ledger/server/category-assignment-job-dto";
import { getLatestCategoryAssignmentJob } from "@/server/category-assignment/reads";

/** The ledger's most recent run, running or finished, or null when it has had none. */
export async function getLatestCategoryAssignmentJobDto(): Promise<CategoryAssignmentJobDto | null> {
  const job = await getLatestCategoryAssignmentJob();
  return job == null ? null : toCategoryAssignmentJobDto(job);
}
