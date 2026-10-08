"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import {
  cancelCategoryAssignmentAction,
  retryCategoryAssignmentFailuresAction,
  retryCategoryAssignmentLatestAction,
} from "@/modules/ledger/server-actions/category-assignment";
import type { CategoryAssignmentJob } from "@/modules/ledger/contracts";
import type { CategoryAssignmentNotice } from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { CategoryAssignmentResultDialog } from "./CategoryAssignmentResultDialog";
import { isCategoryAssignmentJobActive } from "./category-assignment-job-state";
import { batchActionsCopy } from "@/copy/workspace";

const PROGRESS_TOAST_ID = "category-assignment-progress";
const READ_ERROR_TOAST_ID = "category-assignment-read-error";

interface CategoryAssignmentTasksProps {
  job: CategoryAssignmentJob | null;
  isReadError: boolean;
  onRefresh: () => Promise<unknown>;
  /** Hands a restarted run to the page, which reports its outcome once it ends. */
  onTaskRegistered: (job: CategoryAssignmentJob) => void;
  notices: readonly CategoryAssignmentNotice[];
  onNoticeConsumed: (jobId: string) => void;
}

/**
 * The run's controls and its reports, spoken through the same toasts the rest of
 * the ledger uses. While a run moves, one toast carries its progress and the Stop
 * control; when it ends, the outcome replaces it and offers the results. Which
 * rows are being worked on is the lists' own business (see
 * `category-assignment-entry-states`), so nothing here takes up room on the page.
 */
export function CategoryAssignmentTasks({
  job,
  isReadError,
  onRefresh,
  onTaskRegistered,
  notices,
  onNoticeConsumed,
}: CategoryAssignmentTasksProps) {
  const queryClient = useQueryClient();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const retryKeyRef = useRef<{ jobId: string; requestKey: string } | null>(null);
  const retryLatestKeyRef = useRef<{ jobId: string; requestKey: string } | null>(null);
  const cancel = useMutation({
    mutationFn: (jobId: string) => cancelCategoryAssignmentAction({ jobId }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.categoryAssignment(), saved);
      toast.info(batchActionsCopy.categoryJobCancelled);
    },
    onError: () => toast.error(batchActionsCopy.categoryJobStopFailed),
  });
  const retryLatest = useMutation({
    mutationFn: (jobId: string) => {
      if (retryLatestKeyRef.current?.jobId !== jobId) {
        retryLatestKeyRef.current = { jobId, requestKey: crypto.randomUUID() };
      }
      return retryCategoryAssignmentLatestAction(retryLatestKeyRef.current);
    },
    onSuccess: (saved) => {
      onTaskRegistered(saved);
      retryLatestKeyRef.current = null;
      setResultsOpen(false);
    },
    onError: () => toast.error(batchActionsCopy.categoryJobRetryFailed),
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => {
      if (retryKeyRef.current?.jobId !== jobId) {
        retryKeyRef.current = { jobId, requestKey: crypto.randomUUID() };
      }
      return retryCategoryAssignmentFailuresAction(retryKeyRef.current);
    },
    onSuccess: (saved) => {
      onTaskRegistered(saved);
      retryKeyRef.current = null;
      setResultsOpen(false);
    },
    onError: () => toast.error(batchActionsCopy.categoryJobRetryFailed),
  });
  // The toast's buttons outlive the render that made them, so they reach the
  // mutation and the refresh through refs instead of capturing this render's.
  const stopRef = useRef<(jobId: string) => void>(() => undefined);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    stopRef.current = (jobId) => cancel.mutate(jobId);
    refreshRef.current = onRefresh;
  });

  const active = isCategoryAssignmentJobActive(job);
  const jobId = job?.id ?? null;
  const retryingCount = active && job != null ? job.retryingDocumentCount : 0;
  const nextRetryAt = active && job != null ? job.nextRetryAt : null;
  useEffect(() => {
    if (nextRetryAt == null || retryingCount === 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nextRetryAt, retryingCount]);
  const retrySeconds =
    nextRetryAt == null ? 0 : Math.max(0, Math.ceil((Date.parse(nextRetryAt) - clock) / 1000));

  const progressLabel =
    job == null
      ? null
      : job.status === "pending"
        ? batchActionsCopy.categoryJobPending
        : batchActionsCopy.categoryJobProgress({
            processed: job.processedCount,
            total: job.total,
            active: job.activeDocumentCount,
          });
  const progressDescription =
    retryingCount > 0
      ? batchActionsCopy.categoryJobRetrying({ count: retryingCount, seconds: retrySeconds })
      : batchActionsCopy.categoryStopDescription;
  useEffect(() => {
    if (!active || jobId == null || progressLabel == null) {
      toast.dismiss(PROGRESS_TOAST_ID);
      return;
    }
    // Closing it would take away the only Stop control, so it stays until the run ends.
    toast.loading(progressLabel, {
      id: PROGRESS_TOAST_ID,
      description: progressDescription,
      duration: Infinity,
      dismissible: false,
      action: { label: batchActionsCopy.categoryStop, onClick: () => stopRef.current(jobId) },
    });
  }, [active, jobId, progressLabel, progressDescription]);

  useEffect(() => {
    if (!isReadError) {
      toast.dismiss(READ_ERROR_TOAST_ID);
      return;
    }
    toast.warning(batchActionsCopy.categoryJobReadFailed, {
      id: READ_ERROR_TOAST_ID,
      duration: Infinity,
      action: {
        label: batchActionsCopy.categoryRefreshStatus,
        onClick: () => void refreshRef.current(),
      },
    });
  }, [isReadError]);

  useEffect(
    () => () => {
      toast.dismiss(PROGRESS_TOAST_ID);
      toast.dismiss(READ_ERROR_TOAST_ID);
    },
    []
  );

  return (
    <>
      {notices.map((notice) => (
        <CategoryAssignmentNoticeReporter
          key={notice.jobId}
          notice={notice}
          onConsumed={onNoticeConsumed}
          onViewResults={() => setResultsOpen(true)}
        />
      ))}
      {job == null ? null : (
        <CategoryAssignmentResultDialog
          job={job}
          open={resultsOpen}
          onOpenChange={setResultsOpen}
          onRetryFailed={() => retry.mutate(job.id)}
          onRetryLatest={() => retryLatest.mutate(job.id)}
        />
      )}
    </>
  );
}

/**
 * Reports one finished run. It only renders once the messages it speaks in have
 * loaded, so a notice waits for its translation instead of being dropped, and it
 * is consumed on the first report so a re-render cannot say it twice.
 */
function CategoryAssignmentNoticeReporter({
  notice,
  onConsumed,
  onViewResults,
}: {
  notice: CategoryAssignmentNotice;
  onConsumed: (jobId: string) => void;
  onViewResults: () => void;
}) {
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    const { job } = notice;
    const issues = job.failedCount + job.conflictCount + job.skippedCount;
    const options = {
      ...(job.evidenceIncomplete
        ? { description: batchActionsCopy.categoryEvidenceIncomplete }
        : {}),
      ...(job.status !== "succeeded" || issues > 0
        ? { action: { label: batchActionsCopy.categoryViewResults, onClick: onViewResults } }
        : {}),
    };
    if (job.status === "succeeded") {
      toast.success(
        batchActionsCopy.aiCategoryDone({
          applied: job.appliedCount,
          confirmed: job.confirmedCount,
          issues,
        }),
        options
      );
    } else {
      toast.error(batchActionsCopy.aiCategoryFailed, options);
    }
    onConsumed(notice.jobId);
  }, [notice, onConsumed, onViewResults]);
  return null;
}
