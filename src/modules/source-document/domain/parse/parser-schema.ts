import { z } from "zod";
import Decimal from "decimal.js";
import { isValidDecimal, compare } from "@/lib/money/decimal";
import { getAiOutputCopy } from "@/config/ai-output-locales";
import { normalizeTitle } from "@/modules/source-document/title-policy";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { dateHintSchema } from "@/lib/ai/date-organization";

// ===== Decimal string validation =====

/**
 * Zod type for canonical decimal strings.
 * Rejects raw JSON numbers — the AI must output quoted strings.
 */
const decimalStringSchema = z
  .string()
  .refine((v) => isValidDecimal(v), {
    message: 'Must be a valid decimal number string (e.g. "45.00")',
  })
  .refine((value) => /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,3})?$/.test(value), {
    message: "Amount exceeds numeric(21,3)",
  });
const supportedCurrencySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(
    (value): value is (typeof SUPPORTED_CURRENCIES)[number] =>
      (SUPPORTED_CURRENCIES as readonly string[]).includes(value),
    "Unsupported currency"
  );

// ===== Raw Zod schema (AI response shape) =====

/** The reference of a recently recorded entry the row repeats; a malformed one reads as none. */
const alreadyRecordedSchema = z.string().trim().min(1).max(16).nullable().optional().catch(null);

const receiptTotalSchema = z.object({
  receipt_index: z.number().int().min(0),
  amount: decimalStringSchema,
  currency: supportedCurrencySchema,
});

const ledgerEntrySchema = z.object({
  receipt_index: z.number().int().min(0),
  item_name: z.string(),
  amount: decimalStringSchema,
  currency: supportedCurrencySchema,
  category_index: z.number().int().min(0),
  notes: z.string().nullish(),
  date_hint: dateHintSchema,
  already_recorded: alreadyRecordedSchema,
});

const orderAdjustmentSchema = z.object({
  category_index: z.number().int().min(0).default(0),
  receipt_index: z.number().int().min(0),
  item_name: z.string(),
  amount: decimalStringSchema,
  currency: supportedCurrencySchema,
  already_recorded: alreadyRecordedSchema,
});

export const parserOutputSchema = z
  .object({
    outcome: z.enum(["success", "invalid"]).default("success"),
    invalid_reason: z.string().nullish(),
    title: z.string().nullish(),
    receipt_count: z.number().int().min(0).default(1),
    receipt_totals: z.array(receiptTotalSchema).default([]),
    ledger_entries: z.array(ledgerEntrySchema).default([]),
    order_adjustments: z.array(orderAdjustmentSchema).default([]),
    reasoning: z.string(),
  })
  .superRefine((output, ctx) => {
    if (output.outcome !== "success") return;
    if (output.receipt_count < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["receipt_count"],
        message: "Successful output requires a receipt",
      });
      return;
    }
    const expected = new Set(Array.from({ length: output.receipt_count }, (_, index) => index));
    for (const [field, values] of [
      ["ledger_entries", output.ledger_entries],
      ["order_adjustments", output.order_adjustments],
    ] as const) {
      values.forEach((value, index) => {
        if (!expected.has(value.receipt_index)) {
          ctx.addIssue({
            code: "custom",
            path: [field, index, "receipt_index"],
            message: "Receipt index is outside receipt_count",
          });
        }
      });
    }
  });

// ===== Normalized output type =====

type ParsedOutput = z.infer<typeof parserOutputSchema>;

export type NormalizedReceiptTotal = Omit<ParsedOutput["receipt_totals"][number], "amount"> & {
  amount: string;
};

export type NormalizedLedgerEntry = Omit<
  ParsedOutput["ledger_entries"][number],
  "amount" | "notes"
> & {
  amount: string;
  notes: string | null;
  date_hint?: import("@/lib/ai/date-organization").DateHint;
};

export type NormalizedOrderAdjustment = Omit<
  ParsedOutput["order_adjustments"][number],
  "amount"
> & {
  amount: string;
};

export type NormalizedParseOutput = Omit<
  ParsedOutput,
  "invalid_reason" | "title" | "receipt_totals" | "ledger_entries" | "order_adjustments"
> & {
  invalid_reason?: string;
  title: string;
  /**
   * Internal triage label for an invalid outcome this module detected itself,
   * as opposed to the AI declaring it. Never rendered and never persisted as
   * user-facing text.
   */
  internal_diagnostic?: "non_positive_entry";
  receipt_totals: NormalizedReceiptTotal[];
  ledger_entries: NormalizedLedgerEntry[];
  order_adjustments: NormalizedOrderAdjustment[];
};

function fallbackTitleForOutcome(
  output: z.infer<typeof parserOutputSchema>,
  aiLanguage?: string
): string {
  const copy = getAiOutputCopy(aiLanguage);
  switch (output.outcome) {
    case "invalid":
      return copy.invalidContent;
    default:
      return copy.untitledDocument;
  }
}

function normalizeSuccessfulExpenseAmount(amount: string): string {
  return compare(amount, "0") < 0 ? new Decimal(amount).abs().toFixed() : amount;
}

// ===== Normalization =====

export function normalizeResult(
  output: z.infer<typeof parserOutputSchema>,
  aiLanguage?: string
): NormalizedParseOutput {
  // A debit is frequently rendered with a minus sign in banking and app UIs.
  // For a successful expense parse the sign is presentation, not an expense direction.
  const ledgerEntries =
    output.outcome === "success"
      ? output.ledger_entries.map((entry) => ({
          ...entry,
          amount: normalizeSuccessfulExpenseAmount(entry.amount),
        }))
      : output.ledger_entries;
  const receiptTotals =
    output.outcome === "success"
      ? output.receipt_totals.map((total) => ({
          ...total,
          amount: normalizeSuccessfulExpenseAmount(total.amount),
        }))
      : output.receipt_totals;

  // Zero cannot represent a usable expense. Negative successful entries above
  // have already been normalized from debit-display notation.
  const hasNonPositiveEntry = ledgerEntries.some((entry) => compare(entry.amount, "0") <= 0);
  if (hasNonPositiveEntry) {
    return {
      outcome: "invalid",
      internal_diagnostic: "non_positive_entry",
      title: normalizeTitle(output.title, fallbackTitleForOutcome(output, aiLanguage)),
      receipt_count: output.receipt_count,
      receipt_totals: receiptTotals,
      ledger_entries: [],
      order_adjustments: output.order_adjustments,
      reasoning: output.reasoning,
    };
  }

  return {
    outcome: output.outcome,
    ...(output.invalid_reason != null ? { invalid_reason: output.invalid_reason } : {}),
    title: normalizeTitle(output.title, fallbackTitleForOutcome(output, aiLanguage)),
    receipt_count: output.receipt_count,
    receipt_totals: receiptTotals,
    ledger_entries: ledgerEntries.map((e) => ({
      receipt_index: e.receipt_index,
      item_name: e.item_name,
      amount: e.amount,
      currency: e.currency,
      category_index: e.category_index,
      notes: e.notes ?? null,
      date_hint: e.date_hint ?? null,
      already_recorded: e.already_recorded ?? null,
    })),
    order_adjustments: output.order_adjustments,
    reasoning: output.reasoning,
  };
}
