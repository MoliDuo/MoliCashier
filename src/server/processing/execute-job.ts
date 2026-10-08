import "server-only";
import type { ProcessingFailureCode } from "@/modules/source-document/lifecycle";
import type { ProcessingClaimContract, ProcessingJobContract } from "@/server/processing/types";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { classifyFailure, findAppErrorCode, retryDelayMs } from "@/lib/background/retry";
import { holdLease } from "@/lib/db/lease";
import {
  ProcessingCancelledError,
  ProcessingFailure,
} from "@/modules/source-document/domain/parse/contracts";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import {
  claimProcessingJob,
  releaseProcessingJob,
  renewProcessingJobLease,
  rescheduleProcessingJob,
} from "./jobs";
import { processAttempt } from "./attempt-processor";
import { BACKGROUND_MAX_ATTEMPTS } from "@/config/tuning";

function toFailureCode(error: unknown): ProcessingFailureCode {
  if (error instanceof ProcessingFailure) return error.code;
  switch (findAppErrorCode(error)) {
    case "ai_rate_limited":
    case "ai_provider_unavailable":
    case "ai_timeout":
    case "ai_configuration_invalid":
      return "ai_provider_unavailable";
    case "FILE_NOT_FOUND":
      return "storage_failure";
    default:
      return "processing_unavailable";
  }
}

/**
 * What a failed attempt stores as its message: a fixed sentence per failure code. The error's own
 * message can carry database or object-store internals, so it goes to the log only.
 */
const FAILURE_MESSAGES: Record<ProcessingFailureCode, string> = {
  ai_provider_unavailable: "The AI provider could not process the document",
  ai_schema_invalid: "The AI reply could not be read",
  exchange_rate_failure: "Exchange rates could not be loaded",
  storage_failure: "The document's images could not be loaded",
  processing_unavailable: "Processing failed",
  request_bound_retry_exhausted: "Processing retry limit reached",
  processing_timeout: "Processing took too long",
};

export interface ExecuteProcessingJobOptions {
  /** Aborts when the process is shutting down; the attempt is then handed back uncounted. */
  shutdown?: AbortSignal;
}

/**
 * Claims one processing attempt and runs it to an outcome. Returns false when another execution
 * holds it. The worker claims and runs in two steps, so that it counts only what it claimed.
 */
export async function executeProcessingJob(
  job: ProcessingJobContract,
  options: ExecuteProcessingJobOptions = {}
): Promise<boolean> {
  const claim = await claimProcessingJob(job.attemptId);
  if (claim == null) return false;
  await runClaimedJob(claim, options);
  return true;
}

/**
 * Runs a claimed processing attempt: keeps its lease alive while it is parsed and records the
 * outcome. A transient failure gives the attempt back to the queue until it runs out of attempts.
 */
export async function runClaimedJob(
  claim: ProcessingClaimContract,
  options: ExecuteProcessingJobOptions = {}
): Promise<void> {
  const lease = { attemptId: claim.job.attemptId, claimToken: claim.claimToken };
  const failure = {
    sourceDocumentId: claim.job.sourceDocumentId,
    attemptId: claim.job.attemptId,
    failureKind: "processing_error" as const,
    lease,
  };
  const attemptSubject = logIdentifier("attempt", claim.job.attemptId);
  if (claim.runNumber > BACKGROUND_MAX_ATTEMPTS) {
    await recordProcessingFailure({
      ...failure,
      failureMessage: FAILURE_MESSAGES.request_bound_retry_exhausted,
      failureCode: "request_bound_retry_exhausted",
    });
    return;
  }

  const held = holdLease(
    async () => (await renewProcessingJobLease(lease.attemptId, lease.claimToken)) != null,
    (reason, error) => {
      logger.warn(
        { attemptSubject, reason, errorCode: findAppErrorCode(error) ?? "UNKNOWN" },
        "Processing lease was lost; aborting worker"
      );
    }
  );

  const signal =
    options.shutdown == null ? held.signal : AbortSignal.any([held.signal, options.shutdown]);

  try {
    await processAttempt({
      sourceDocumentId: claim.job.sourceDocumentId,
      attemptId: claim.job.attemptId,
      signal,
      lease,
    });
  } catch (error) {
    if (options.shutdown?.aborted === true && !held.signal.aborted) {
      // The release is fenced on the lease and on the attempt still processing, so an attempt that
      // was cancelled or finished in the meantime is left alone.
      await releaseProcessingJob(lease);
      return;
    }
    if (error instanceof ProcessingCancelledError || held.signal.aborted) return;
    const classified = classifyFailure(error);
    if (classified.kind === "transient" && claim.runNumber < BACKGROUND_MAX_ATTEMPTS) {
      const delayMs = retryDelayMs(claim.runNumber, classified.retryAfterMs);
      logger.warn(
        { attemptSubject, errorCode: classified.code, runNumber: claim.runNumber, delayMs },
        "Processing failed transiently; retrying later"
      );
      await rescheduleProcessingJob(lease, delayMs);
      return;
    }
    if (classified.kind === "configuration") {
      logger.error(
        { attemptSubject, errorCode: classified.code },
        "Processing failed on provider configuration"
      );
    } else {
      logger.warn({ attemptSubject, error, errorCode: classified.code }, "Processing failed");
    }
    const failureCode = toFailureCode(error);
    await recordProcessingFailure({
      ...failure,
      failureMessage: FAILURE_MESSAGES[failureCode],
      failureCode,
    });
  } finally {
    held.stop();
  }
}
