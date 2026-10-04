import type { CategoryInfo, ParsedLedgerEntry } from "@/lib/ai/types";

export interface ParseSourceDocumentInput {
  text?: string;
  evidence?: ParseEvidence;
  categories: CategoryInfo[];
  aiLanguage?: string;
  settings: { aiCustomPrompt?: string };
  preferredCurrencies?: string[];
}

interface ParseEvidence {
  images: readonly { dataUrl: string }[];
}

export type ProcessingFailureCode =
  | "storage_failure"
  | "ai_provider_unavailable"
  | "ai_schema_invalid"
  | "exchange_rate_failure"
  | "processing_unavailable"
  | "processing_timeout";

export class ProcessingFailure extends Error {
  constructor(
    readonly code: ProcessingFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ProcessingFailure";
  }
}

/**
 * Why a document that the AI processed produced no entries. This is internal
 * triage metadata stored in the attempt's failure code; it is never rendered.
 * The ledger owner instead reads the AI-written natural-language reason.
 */
export type InvalidDiagnostic =
  "ai_declared_invalid" | "non_positive_entry" | "entry_validation_failed";

export type ParseSourceDocumentOutput =
  | {
      ledgerEntries: ParsedLedgerEntry[];
      title?: string;
      verificationStatus: "passed";
      dateHints?: import("@/lib/ai/date-organization").DateHint[];
    }
  | {
      ledgerEntries: ParsedLedgerEntry[];
      title?: string;
      verificationStatus: "invalid";
      reason?: string;
      diagnostic: InvalidDiagnostic;
    };

export type ParsePipelineResult =
  | {
      kind: "success";
      title: string;
      ledgerEntries: ParsedLedgerEntry[];
      dateHints?: import("@/lib/ai/date-organization").DateHint[];
    }
  | { kind: "invalid"; title: string; reason?: string; diagnostic: InvalidDiagnostic }
  | { kind: "cancelled" };

export class ProcessingCancelledError extends Error {
  constructor() {
    super("Processing cancelled");
    this.name = "ProcessingCancelledError";
  }
}

export function throwIfProcessingCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ProcessingCancelledError();
}
