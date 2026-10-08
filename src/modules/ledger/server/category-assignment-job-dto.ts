import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";
import type { CategoryAssignmentJobRecord } from "@/server/category-assignment/reads";

/**
 * The stored run as the client sees it. Selection rows stay on the server;
 * the DTO exposes mutually exclusive final-outcome counts.
 */
export function toCategoryAssignmentJobDto(
  job: CategoryAssignmentJobRecord
): CategoryAssignmentJobDto {
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    total: job.entryCount,
    processedCount:
      job.appliedCount +
      job.confirmedCount +
      job.failedCount +
      job.conflictCount +
      job.skippedCount +
      job.cancelledCount,
    appliedCount: job.appliedCount,
    confirmedCount: job.confirmedCount,
    failedCount: job.failedCount,
    conflictCount: job.conflictCount,
    skippedCount: job.skippedCount,
    cancelledCount: job.cancelledCount,
    documentTotal: job.documentTotal,
    documentCompleted: job.documentCompleted,
    activeDocumentCount: job.activeDocumentCount,
    retryingDocumentCount: job.retryingDocumentCount,
    nextRetryAt: job.nextRetryAt,
    candidateCategories: job.candidateSnapshot,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    canRetryFailed: job.failedCount > 0 && ["partial", "failed"].includes(job.status),
    evidenceIncomplete: job.evidenceIncomplete,
  };
}
