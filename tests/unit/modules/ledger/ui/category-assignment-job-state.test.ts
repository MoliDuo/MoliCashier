import { describe, expect, it } from "vitest";
import type { CategoryAssignmentJob } from "@/modules/ledger/contracts";
import { isCategoryAssignmentJobActive } from "@/modules/ledger/ui/category-assignment-job-state";

function job(overrides: Partial<CategoryAssignmentJob> = {}): CategoryAssignmentJob {
  return {
    id: "job-1",

    mode: { kind: "clear" },
    status: "succeeded",
    total: 10,
    processedCount: 10,
    appliedCount: 9,
    confirmedCount: 1,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 10,
    documentCompleted: 10,
    activeDocumentCount: 0,
    retryingDocumentCount: 0,
    nextRetryAt: null,
    candidateCategories: [],
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:01:00.000Z",
    completedAt: "2026-09-14T00:01:00.000Z",
    canRetryFailed: false,
    evidenceIncomplete: false,
    ...overrides,
  };
}

describe("isCategoryAssignmentJobActive", () => {
  it("counts every in-flight status and nothing else", () => {
    expect(isCategoryAssignmentJobActive(job({ status: "pending" }))).toBe(true);
    expect(isCategoryAssignmentJobActive(job({ status: "running" }))).toBe(true);
    expect(isCategoryAssignmentJobActive(job({ status: "succeeded" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "partial" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "failed" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "cancelled" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(null)).toBe(false);
  });
});
