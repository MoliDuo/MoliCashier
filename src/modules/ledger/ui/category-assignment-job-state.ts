import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";

const ACTIVE_CATEGORY_ASSIGNMENT_STATUSES = new Set(["pending", "running"]);

/**
 * The single test for "this run is still moving". The toasts, the polling
 * schedule, the row marks and the settings warning all ask the same question, so
 * they read the same answer instead of each carrying their own status list.
 */
export function isCategoryAssignmentJobActive(job: CategoryAssignmentJobDto | null): boolean {
  return job != null && ACTIVE_CATEGORY_ASSIGNMENT_STATUSES.has(job.status);
}
