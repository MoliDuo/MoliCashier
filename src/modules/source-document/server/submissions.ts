import { and, asc, eq } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { sourceDocumentFiles, extractionAttempts, sourceDocuments } from "@/persistence";
import {
  createProcessingAttemptInTransaction,
  type SourceDocumentContract,
  type SourceDocumentAttemptContract,
} from "@/modules/source-document/server/extraction-attempts";
import type { ProcessingJobContract } from "@/server/processing/types";
import { lockLedgerForUpdate, type PostgresTransaction } from "@/lib/db/transaction-locks";

async function submitInTransaction(
  tx: PostgresTransaction,
  input: SourceDocumentSubmissionInput,
  idempotency?: SourceDocumentIdempotencyInput
): Promise<SourceDocumentSubmissionResult> {
  let attemptInput = input.input;
  // Lock order: ledger → source document, as every other writer takes them.
  await lockLedgerForUpdate(tx);

  if (input.sourceDocumentId != null) {
    const document = await tx
      .select({
        inputText: sourceDocuments.inputText,
        documentDate: sourceDocuments.documentDate,
        latestAttemptId: sourceDocuments.latestAttemptId,
      })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, input.sourceDocumentId))
      .for("update")
      .then((rows) => rows[0]);
    if (document == null) throw new NotFoundError("Source document");
    const inputAttemptId = document.latestAttemptId;

    if (input.inheritInput === true) {
      if (inputAttemptId == null)
        throw new ConflictError("Source document has no submission input");
      // The text and files are the document's current input. The day is the
      // record's own, so a date the owner set by hand since the last parse
      // survives the retry; the reference date the parse read the input with
      // stays on the submission it came with.
      const previousInput = await tx
        .select({ dateReference: extractionAttempts.referenceDate })
        .from(extractionAttempts)
        .where(
          and(
            eq(extractionAttempts.id, inputAttemptId),
            eq(extractionAttempts.sourceDocumentId, input.sourceDocumentId)
          )
        )
        .then((rows) => rows[0]);
      if (previousInput == null) throw new ConflictError("Source document has no submission input");
      const storedFileIds = (
        await tx
          .select({ id: sourceDocumentFiles.storedFileId })
          .from(sourceDocumentFiles)
          .where(eq(sourceDocumentFiles.sourceDocumentId, input.sourceDocumentId))
          .orderBy(asc(sourceDocumentFiles.position))
      ).map((file) => file.id);
      attemptInput = {
        ...previousInput,
        documentDate: document.documentDate,
        text: document.inputText,
        storedFileIds,
      };
    }

    if (input.supersedeProcessing === true && document?.latestAttemptId != null) {
      await tx
        .update(extractionAttempts)
        .set({ status: "cancelled", finishedAt: new Date() })
        .where(
          and(
            eq(extractionAttempts.id, document.latestAttemptId),
            eq(extractionAttempts.status, "processing")
          )
        );
    }
  }

  if (attemptInput == null) throw new ValidationError("Submission input is required");
  if (
    (attemptInput.text == null || attemptInput.text.trim() === "") &&
    attemptInput.storedFileIds.length === 0
  ) {
    throw new ValidationError("Submission text and files cannot both be empty");
  }

  const pending = await createProcessingAttemptInTransaction(
    tx,
    input.sourceDocumentId == null
      ? {
          bookId: input.bookId!,
          input: attemptInput,
          ...(idempotency == null
            ? {}
            : {
                idempotency: {
                  source: idempotencySource(idempotency),
                  key: idempotency.key,
                  fingerprint: idempotency.contentFingerprint,
                },
              }),
        }
      : {
          sourceDocumentId: input.sourceDocumentId,
          input: attemptInput,
        }
  );
  // The processing attempt is its own queue entry; recovery picks it up if the
  // request that scheduled its run dies first.
  const job = {
    sourceDocumentId: pending.document.id,
    attemptId: pending.attempt.id,
    requestedAt: pending.attempt.submittedAt,
  };
  return { ...pending, job };
}

function idempotencySource(idempotency: SourceDocumentIdempotencyInput): string {
  return `${idempotency.principalType}:${idempotency.principalId}`;
}

/**
 * The document an earlier create request with this key made, or null. Keys never expire; one reused with other content is refused rather
 * than replayed.
 */
export async function findIdempotentSubmission(
  idempotency: SourceDocumentIdempotencyInput,
  executor: PostgresTransaction | typeof db = db
): Promise<SourceDocumentSubmissionContract | null> {
  const { key } = idempotency;
  if (key.trim() === "" || key.length > 512) {
    throw new ValidationError("Idempotency key must contain between 1 and 512 characters");
  }
  const document = await executor
    .select({
      id: sourceDocuments.id,
      attemptId: sourceDocuments.latestAttemptId,
      fingerprint: sourceDocuments.idempotencyFingerprint,
    })
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.idempotencySource, idempotencySource(idempotency)),
        eq(sourceDocuments.idempotencyKey, key)
      )
    )
    .then((rows) => rows[0]);
  if (document == null) return null;
  if (document.fingerprint !== idempotency.contentFingerprint) {
    throw new ConflictError("Idempotency key was already used with different content");
  }
  // Creating a document sets its latest submission in the same transaction.
  return {
    sourceDocumentId: document.id,
    attemptId: document.attemptId!,
    processingStatus: "processing",
  };
}

export async function submitSourceDocument(
  input: SourceDocumentSubmissionInput
): Promise<SourceDocumentSubmissionResult> {
  return db.transaction((tx) => submitInTransaction(tx, input));
}

/**
 * Creates a document that carries the request's idempotency key, or replays
 * the one an earlier request with the key created. Creations queue on the
 * ledger lock, so a concurrent repeat waits for the first to commit and then
 * finds its document.
 */
export async function submitSourceDocumentIdempotently(
  input: SourceDocumentSubmissionInput & { bookId: string; sourceDocumentId?: never },
  idempotency: SourceDocumentIdempotencyInput
): Promise<
  | { replayed: false; submission: SourceDocumentSubmissionResult }
  | { replayed: true; existing: SourceDocumentSubmissionContract }
> {
  return db.transaction(async (tx) => {
    await lockLedgerForUpdate(tx);
    const existing = await findIdempotentSubmission(idempotency, tx);
    if (existing != null) return { replayed: true, existing };
    return { replayed: false, submission: await submitInTransaction(tx, input, idempotency) };
  });
}

export interface SourceDocumentSubmissionContract {
  sourceDocumentId: string;
  attemptId: string;
  processingStatus: "processing";
}

export interface SourceDocumentSubmissionResult {
  document: SourceDocumentContract;
  attempt: SourceDocumentAttemptContract;
  job: ProcessingJobContract;
}

/** Atomically persists submitted evidence as a processing attempt ready to be claimed. */
export type SourceDocumentSubmissionInput = {
  input?: SourceDocumentInputContract;
  inheritInput?: boolean;
  supersedeProcessing?: boolean;
} & ({ sourceDocumentId: string; bookId?: string } | { sourceDocumentId?: never; bookId: string });

export interface SourceDocumentInputContract {
  text: string | null;
  storedFileIds: readonly string[];
  documentDate: string | null;
  dateReference?: string | null;
}

export interface SourceDocumentIdempotencyInput {
  principalType: "credential" | "user";
  principalId: string;
  key: string;
  contentFingerprint: string | null;
}
