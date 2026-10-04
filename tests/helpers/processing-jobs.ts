import { eq } from "drizzle-orm";
import type { AttemptProcessingRequestContract } from "@/server/processing/types";
import type { GenerateStructured } from "@/lib/ai/structured";
import { processAttempt } from "@/server/processing/attempt-processor";
import {
  claimProcessingJob,
  recoverProcessingJobs,
  renewProcessingJobLease,
} from "@/server/processing/jobs";
import { extractionAttempts } from "@/persistence";
import { getTestDb } from "../setup";

/** The processing queue functions under test. */
export function processingJobs() {
  return {
    claim: (attemptId: string) => claimProcessingJob(attemptId),
    renew: (attemptId: string, claimToken: string) =>
      renewProcessingJobLease(attemptId, claimToken),
    recoverBatch: (maxBatch: number) => recoverProcessingJobs(maxBatch),
    /** Leases run on the database clock, so a test expires one by moving it into the past. */
    expireLease: (attemptId: string) =>
      getTestDb()
        .update(extractionAttempts)
        .set({ claimExpiresAt: new Date(Date.now() - 60_000) })
        .where(eq(extractionAttempts.id, attemptId)),
  };
}

/** An attempt processor whose model calls go through the given generator. */
export function attemptProcessor(generate: GenerateStructured) {
  return {
    process: (request: AttemptProcessingRequestContract) => processAttempt(request, { generate }),
  };
}
