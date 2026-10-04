import "server-only";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { classifyFailure, retryDelayMs } from "@/lib/background/retry";
import { holdLease } from "@/lib/db/lease";
import { applyCategoryAssignments } from "@/modules/source-document/server/category-assignments";
import { isSuccessfulLoadImageResult, loadStoredFilesForAI } from "@/server/processing/evidence";
import { BACKGROUND_MAX_ATTEMPTS } from "@/config/tuning";
import type {
  CategoryAssignmentDocumentWork,
  ClaimedCategoryAssignmentJob,
} from "@/server/category-assignment/assignments";
import {
  claimCategoryAssignmentJob,
  failCategoryAssignmentDocument,
  loadCategoryAssignmentSelection,
  markCategoryAssignmentEvidenceIncomplete,
  nextCategoryAssignmentDocument,
  persistCategoryAssignmentDecisions,
  releaseCategoryAssignmentJob,
  renewCategoryAssignmentLease,
  rescheduleCategoryAssignmentDocument,
  yieldCategoryAssignmentDocument,
} from "@/server/category-assignment/assignments";
import { loadCategoryAssignmentDocumentGroups } from "@/server/category-assignment/document-groups";
import { decideEntryCategories } from "@/server/category-assignment/decide-entry-categories";

const REQUEST_CHUNK_SIZE = 50;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

interface RunSignals {
  /** Aborts when the lease is lost or the process is shutting down. */
  signal: AbortSignal;
  /** Aborts when the process is shutting down. */
  shutdown: AbortSignal;
  /** Aborts when the lease is lost or cannot be renewed. */
  lease: AbortSignal;
}

/** The run is stopping because the process is, not because the lease was lost. */
function stoppedByShutdown({ shutdown, lease }: RunSignals): boolean {
  return shutdown.aborted && !lease.aborted;
}

/**
 * Asks the model about one document's entries, a request block at a time, then
 * writes the decisions. Returns false when the run has to stop: its lease is
 * gone or the process is shutting down.
 */
async function processDocument(
  job: ClaimedCategoryAssignmentJob,
  document: CategoryAssignmentDocumentWork,
  signals: RunSignals
): Promise<boolean> {
  const { signal } = signals;
  const { sourceDocumentId } = document;
  const startedAt = Date.now();
  const subject = {
    jobSubject: logIdentifier("processing-job", job.jobId),
    documentSubject: logIdentifier("source-document", sourceDocumentId),
    runNumber: document.runNumber,
  };
  if (document.runNumber > BACKGROUND_MAX_ATTEMPTS) {
    // Every earlier attempt died without recording an outcome.
    await failCategoryAssignmentDocument({
      lease: job,
      sourceDocumentId,
      errorCode: document.lastErrorCode ?? "ai_timeout",
    });
    logger.warn(subject, "Category assignment document ran out of attempts");
    return true;
  }
  try {
    if (job.mode.kind === "ai") {
      const entryIds = await loadCategoryAssignmentSelection({
        jobId: job.jobId,
        sourceDocumentId,
      });
      const groups = await loadCategoryAssignmentDocumentGroups({ ledgerEntryIds: entryIds });
      // A document that no longer holds these entries is settled by the apply.
      const group = groups.find((candidate) => candidate.sourceDocumentId === sourceDocumentId);
      if (group != null) {
        const loaded = await loadStoredFilesForAI([...group.storedFileIds]);
        const images = loaded
          .filter(isSuccessfulLoadImageResult)
          .map((image) => ({ dataUrl: image.dataUrl }));
        if (loaded.some((image) => !image.success)) {
          await markCategoryAssignmentEvidenceIncomplete(job, sourceDocumentId);
        }
        for (
          let chunkIndex = document.completedChunkCount;
          chunkIndex * REQUEST_CHUNK_SIZE < group.subjects.length;
          chunkIndex += 1
        ) {
          if (signal.aborted) {
            if (stoppedByShutdown(signals)) {
              await yieldCategoryAssignmentDocument(job, sourceDocumentId);
            }
            return false;
          }
          const chunk = {
            ...group,
            subjects: group.subjects.slice(
              chunkIndex * REQUEST_CHUNK_SIZE,
              (chunkIndex + 1) * REQUEST_CHUNK_SIZE
            ),
          };
          const aiStartedAt = Date.now();
          const result = await decideEntryCategories({
            candidates: job.candidates,
            group: chunk,
            images,
            signal,
            ...(job.customPrompt == null || job.customPrompt === ""
              ? {}
              : { customPrompt: job.customPrompt }),
            ...(job.learnedPreferences == null || job.learnedPreferences === ""
              ? {}
              : { learnedPreferences: job.learnedPreferences }),
          });
          const persisted = await persistCategoryAssignmentDecisions({
            lease: job,
            sourceDocumentId,
            decisions: result.decisions,
            completedChunkCount: chunkIndex + 1,
          });
          logger.info(
            {
              ...subject,
              entryCount: chunk.subjects.length,
              imageCount: images.length,
              aiDurationMs: Date.now() - aiStartedAt,
              errorCode: persisted ? null : "claim_lost",
            },
            "Category assignment request block finished"
          );
          if (!persisted) return false;
        }
      }
    }
    const commitStartedAt = Date.now();
    const result = await applyCategoryAssignments({ lease: job, sourceDocumentId });
    logger.info(
      {
        ...subject,
        databaseCommitDurationMs: Date.now() - commitStartedAt,
        totalDurationMs: Date.now() - startedAt,
        outcome: result.status,
      },
      "Category assignment document finished"
    );
    return result.status !== "claim_lost";
  } catch (error) {
    if (signal.aborted) {
      // A lost lease aborts the request and there is nothing left to record; a shutdown hands the
      // document back uncounted, keeping the blocks already done.
      if (stoppedByShutdown(signals)) await yieldCategoryAssignmentDocument(job, sourceDocumentId);
      return false;
    }
    const failure = classifyFailure(error);
    const errorCode = failure.code ?? "ai_provider_unavailable";
    const retrying = failure.kind === "transient" && document.runNumber < BACKGROUND_MAX_ATTEMPTS;
    const recorded = retrying
      ? await rescheduleCategoryAssignmentDocument({
          lease: job,
          sourceDocumentId,
          errorCode,
          delayMs: retryDelayMs(document.runNumber, failure.retryAfterMs),
        })
      : await failCategoryAssignmentDocument({ lease: job, sourceDocumentId, errorCode });
    const details = { ...subject, totalDurationMs: Date.now() - startedAt, errorCode, retrying };
    // A configuration failure fails every document the same way until fixed.
    if (failure.kind === "configuration") {
      logger.error(details, "Category assignment document failed");
    } else {
      logger.warn(details, "Category assignment document failed");
    }
    return recorded;
  }
}

/**
 * Works through a claimed job's documents one at a time until none is left, the lease is lost or the
 * process is shutting down. A document waiting out a retry is waited for.
 */
async function runJob(job: ClaimedCategoryAssignmentJob, shutdown: AbortSignal): Promise<void> {
  const lease = holdLease(
    () => renewCategoryAssignmentLease(job),
    (reason, error) =>
      logger.warn(
        { error, reason, jobSubject: logIdentifier("processing-job", job.jobId) },
        "Category assignment lease lost"
      )
  );
  const signals: RunSignals = {
    signal: AbortSignal.any([lease.signal, shutdown]),
    shutdown,
    lease: lease.signal,
  };
  try {
    while (!signals.signal.aborted) {
      const next = await nextCategoryAssignmentDocument(job);
      if (next.kind === "lost") return;
      if (next.kind === "done") break;
      if (next.kind === "wait") {
        await sleep(next.delayMs, signals.signal);
        continue;
      }
      if (!(await processDocument(job, next.document, signals))) break;
    }
  } finally {
    lease.stop();
  }
  await releaseCategoryAssignmentJob(job);
}

/**
 * Claims the next category job that has work due and runs it to completion. False when there was
 * none. A process that is shutting down hands the job back, and the next one resumes it.
 */
export async function runNextCategoryAssignmentJob(
  shutdown: AbortSignal,
  scope: { jobId?: string } = {}
): Promise<boolean> {
  const job = await claimCategoryAssignmentJob(scope);
  if (job == null) return false;
  await runJob(job, shutdown);
  return true;
}
