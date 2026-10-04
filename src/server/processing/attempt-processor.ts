import "server-only";
import type {
  AttemptProcessingRequestContract,
  AttemptProcessingResultContract,
} from "@/server/processing/types";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { compare } from "@/lib/money/decimal";
import {
  buildEntriesForInsert,
  getEntryFallbackDate,
  validateEntries,
} from "@/modules/source-document/domain/parse/entry-builder";
import { runParsePipeline } from "@/modules/source-document/domain/parse/pipeline";
import { toParseSourceDocumentOutput } from "@/modules/source-document/domain/parse/result-mapper";
import {
  ProcessingCancelledError,
  ProcessingFailure,
  throwIfProcessingCancelled,
  type InvalidDiagnostic,
} from "@/modules/source-document/domain/parse/contracts";
import { normalizeFailureReason } from "@/modules/source-document/failure-reason-policy";
import {
  isFailedLoadImageResult,
  isSuccessfulLoadImageResult,
  loadStoredFilesForAI,
} from "./evidence";
import { loadAttemptProcessingContext } from "./context";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { ledgerToday } from "@/modules/ledger/server/query-period";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import { generateStructured, type GenerateStructured } from "@/lib/ai/structured";
import { createDateOrganizationSuggestion } from "@/modules/source-document/date-organization";

function failureLogContext(
  request: AttemptProcessingRequestContract,
  failureCode: InvalidDiagnostic
): Record<string, unknown> {
  return {
    sourceDocumentSubject: logIdentifier("source-document", request.sourceDocumentId),
    attemptSubject: logIdentifier("attempt", request.attemptId),
    failureCode,
  };
}

export interface ProcessAttemptOptions {
  /** Replaces the structured model call; tests pass a scripted generator here. */
  generate?: GenerateStructured;
}

/**
 * Parses one pending attempt and either activates its entries or records why
 * it could not. Every write is fenced by the caller's processing lease.
 */
export async function processAttempt(
  request: AttemptProcessingRequestContract,
  options: ProcessAttemptOptions = {}
): Promise<AttemptProcessingResultContract> {
  const signal = request.signal;
  throwIfProcessingCancelled(signal);
  const [context, ledgerSettings] = await Promise.all([
    loadAttemptProcessingContext(request),
    getLedgerSettings(),
  ]);
  const { attempt, document, storedFileIds, categories } = context;
  if (attempt == null || document == null) throw new NotFoundError("Pending attempt");
  // The claim only hands out the current, still-processing submission; one that
  // finished or was superseded since is someone else's to close.
  if (document.latestAttemptId !== request.attemptId || attempt.processingStatus !== "processing") {
    throw new ProcessingCancelledError();
  }
  throwIfProcessingCancelled(signal);

  const loadedEvidence = await loadStoredFilesForAI(storedFileIds);
  throwIfProcessingCancelled(signal);
  const failedEvidence = loadedEvidence.filter(isFailedLoadImageResult);
  if (failedEvidence.length > 0) {
    throw new ProcessingFailure(
      "storage_failure",
      `Failed to load ${failedEvidence.length} source document evidence file(s)`,
      { cause: failedEvidence[0]?.error }
    );
  }
  const evidence = loadedEvidence.filter(isSuccessfulLoadImageResult);
  const pipeline = await runParsePipeline(
    {
      ...(attempt.inputText == null ? {} : { text: attempt.inputText }),
      ...(evidence.length === 0
        ? {}
        : { evidence: { images: evidence.map((item) => ({ dataUrl: item.dataUrl })) } }),
      categories,
      ...(ledgerSettings?.aiCustomPrompt !== undefined
        ? { settings: { aiCustomPrompt: ledgerSettings.aiCustomPrompt } }
        : { settings: {} }),
      ...(ledgerSettings?.aiLanguage !== undefined
        ? { aiLanguage: ledgerSettings.aiLanguage }
        : {}),
      ...(ledgerSettings?.currencies !== undefined
        ? { preferredCurrencies: ledgerSettings.currencies }
        : {}),
    },
    {
      signal,
      generate: options.generate ?? generateStructured,
    }
  );
  throwIfProcessingCancelled(signal);
  const output = toParseSourceDocumentOutput(pipeline);
  if (output.verificationStatus !== "passed") {
    const failureMessage = normalizeFailureReason(output.reason);
    logger.warn(failureLogContext(request, output.diagnostic), "Attempt could not be parsed");
    const preserved = await recordProcessingFailure({
      ...request,
      failureKind: "invalid_input",
      failureMessage,
      failureCode: output.diagnostic,
    });
    if (!preserved) {
      throw new ProcessingCancelledError();
    }
    return {
      processingStatus: "failed",
      ...(failureMessage == null ? {} : { failureMessage }),
    };
  }

  const validation = validateEntries(output.ledgerEntries);
  throwIfProcessingCancelled(signal);
  if (!validation.isValid) {
    logger.warn(
      {
        ...failureLogContext(request, "entry_validation_failed"),
        validationReason: validation.reason ?? null,
      },
      "Attempt entries failed validation; no entries were recorded"
    );
    const preserved = await recordProcessingFailure({
      ...request,
      failureKind: "invalid_input",
      failureMessage: null,
      failureCode: "entry_validation_failed",
    });
    if (!preserved) {
      throw new ProcessingCancelledError();
    }
    return { processingStatus: "failed" };
  }
  const { fallbackDate } = getEntryFallbackDate(
    attempt.requestedDate,
    ledgerToday(ledgerSettings?.timeZone ?? "UTC")
  );
  const validEntries = output.ledgerEntries.filter(
    (entry) => compare(entry.amount, "0") > 0 || entry.isAdjustment === true
  );
  const entries = buildEntriesForInsert({
    validEntries,
    categories,
    sourceDocumentId: request.sourceDocumentId,
    fallbackDate,
  });
  const entryInputs = entries.map((entry) => ({
    id: entry.id,
    categoryId: entry.categoryId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    createdAt: entry.entryDate,
    ...(entry.dateHint == null ? {} : { dateHint: entry.dateHint }),
  }));

  const dateOrganizationSuggestion = createDateOrganizationSuggestion({
    referenceDate: attempt.referenceDate,
    sourceDocumentDate: fallbackDate,
    entries,
  });

  // Cache the rates for the day the entries will be read on, so they show
  // converted as soon as they appear. Without them the entries still save and
  // show unconverted until maintenance fills the day.
  await ensureExchangeRates([attempt.requestedDate ?? document.documentDate]);
  throwIfProcessingCancelled(signal);
  const activated = await activateAttempt({
    ...request,
    ...(output.title == null ? {} : { title: output.title }),
    entries: entryInputs,
    dateOrganizationSuggestion,
  });
  if (!activated) {
    throw new ProcessingCancelledError();
  }
  return { processingStatus: "completed" };
}
