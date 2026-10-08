import { compare } from "@/lib/money/decimal";
import {
  ProcessingCancelledError,
  type ParsedLedgerEntry,
  type ParsePipelineResult,
  type ParseSourceDocumentOutput,
} from "./contracts";
import type {
  NormalizedLedgerEntry,
  NormalizedOrderAdjustment,
  NormalizedParseOutput,
} from "./parser-schema";
import { normalizeFailureReason } from "@/modules/source-document/domain/failure-reason-policy";
import { roundToCurrency } from "@/lib/money/currency-precision";
import type { DateHint } from "@/lib/source-document/suggestions";

export function convertToParsedEntries({
  ledgerEntries,
  orderAdjustments,
}: {
  ledgerEntries: NormalizedLedgerEntry[];
  orderAdjustments: NormalizedOrderAdjustment[];
}): ParsedLedgerEntry[] {
  const inheritedDateHintsByReceipt = new Map<number, DateHint>();
  const receiptIndexes = new Set(ledgerEntries.map((entry) => entry.receipt_index));
  for (const receiptIndex of receiptIndexes) {
    const receiptEntries = ledgerEntries.filter((entry) => entry.receipt_index === receiptIndex);
    const firstHint = receiptEntries[0]?.date_hint;
    if (firstHint == null) continue;
    const allEntriesShareHint = receiptEntries.every(
      (entry) =>
        entry.date_hint != null &&
        entry.date_hint.kind === firstHint.kind &&
        entry.date_hint.value === firstHint.value
    );
    if (allEntriesShareHint) inheritedDateHintsByReceipt.set(receiptIndex, firstHint);
  }
  const adjustments = orderAdjustments
    .filter((entry) => compare(entry.amount, "0") !== 0)
    .map((entry) => {
      const items = ledgerEntries.filter((item) => item.receipt_index === entry.receipt_index);
      const categories = new Set(items.map((item) => item.category_index));
      const sharedCategory = categories.size === 1 ? items[0]?.category_index : 0;
      const categoryIndex = entry.category_index > 0 ? entry.category_index : (sharedCategory ?? 0);
      const inheritedDateHint = inheritedDateHintsByReceipt.get(entry.receipt_index);
      return {
        ...entry,
        category_index: categoryIndex,
        notes: null,
        ...(inheritedDateHint == null ? {} : { date_hint: inheritedDateHint }),
      };
    });
  const entries = [...ledgerEntries, ...adjustments];

  return entries.map((entry, index) => ({
    itemName: entry.item_name,
    amount: roundToCurrency(entry.amount, entry.currency),
    currency: entry.currency,
    categoryIndex: entry.category_index,
    entryDate: null,
    notes: entry.notes,
    ...("date_hint" in entry && entry.date_hint != null ? { dateHint: entry.date_hint } : {}),
    ...(entry.already_recorded == null ? {} : { alreadyRecorded: entry.already_recorded }),
    receiptIndex: entry.receipt_index,
    isAdjustment: index >= ledgerEntries.length,
  }));
}

/** What one parse reply means: the document is invalid, or these are its entries. */
export function resolveParseOutcome(result: NormalizedParseOutput): ParsePipelineResult {
  if (result.outcome === "invalid") {
    const reason = normalizeFailureReason(result.invalid_reason);
    return {
      kind: "invalid",
      title: result.title,
      diagnostic: result.internal_diagnostic ?? "ai_declared_invalid",
      ...(reason == null ? {} : { reason }),
    };
  }
  return {
    kind: "success",
    title: result.title,
    ledgerEntries: convertToParsedEntries({
      ledgerEntries: result.ledger_entries,
      orderAdjustments: result.order_adjustments,
    }),
    dateHints: [
      ...result.ledger_entries.map((entry) => entry.date_hint ?? null),
      ...result.order_adjustments.map(() => null),
    ],
  };
}

export function toParseSourceDocumentOutput(
  result: ParsePipelineResult
): ParseSourceDocumentOutput {
  switch (result.kind) {
    case "success":
      return {
        ledgerEntries: result.ledgerEntries,
        title: result.title,
        ...(result.dateHints == null ? {} : { dateHints: result.dateHints }),
        verificationStatus: "passed",
      };
    case "invalid":
      return {
        ledgerEntries: [],
        title: result.title,
        verificationStatus: "invalid",
        diagnostic: result.diagnostic,
        ...(result.reason == null ? {} : { reason: result.reason }),
      };
    case "cancelled":
      throw new ProcessingCancelledError();
  }
}
