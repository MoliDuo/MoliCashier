import { z } from "zod";
import Decimal from "decimal.js";
import { isValidDecimal, compare } from "@/lib/money/decimal";
import { roundToCurrency } from "@/lib/money/currency-precision";
import { getAiOutputCopy } from "@/config/ai-output-locales";
import { normalizeTitle } from "@/modules/source-document/domain/title-policy";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { dateHintSchema } from "@/lib/source-document/suggestions";

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
/**
 * Any ISO 4217 code is accepted here. Whether the ledger supports it is decided afterwards, so an
 * unsupported currency becomes a clear refusal instead of a schema error the repair round would
 * "fix" by swapping in another currency.
 */
const currencySchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Must be an ISO 4217 three-letter currency code");

const supportedCurrencies: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES);

// ===== Raw Zod schema (AI response shape) =====

/** The reference of a recently recorded entry the row repeats; a malformed one reads as none. */
const alreadyRecordedSchema = z.string().trim().min(1).max(16).nullable().optional().catch(null);

const receiptTotalSchema = z.object({
  receipt_index: z.number().int().min(0),
  amount: decimalStringSchema,
  currency: currencySchema,
});

const ledgerEntrySchema = z.object({
  receipt_index: z.number().int().min(0),
  item_name: z.string(),
  amount: decimalStringSchema,
  currency: currencySchema,
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
  currency: currencySchema,
  already_recorded: alreadyRecordedSchema,
});

export const parserOutputSchema = z
  .object({
    outcome: z.enum(["success", "invalid"]).default("success"),
    invalid_reason: z.string().nullish(),
    title: z.string().nullish(),
    receipt_count: z.number().int().min(0).default(1),
    // Ahead of the rows: the model writes its reasoning first and the rows follow from it.
    reasoning: z.string(),
    receipt_totals: z.array(receiptTotalSchema).default([]),
    ledger_entries: z.array(ledgerEntrySchema).default([]),
    order_adjustments: z.array(orderAdjustmentSchema).default([]),
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
  date_hint?: import("@/lib/source-document/suggestions").DateHint;
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
  internal_diagnostic?: "non_positive_entry" | "unsupported_currency";
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

/** True for an amount that is zero once rounded to its currency's minor unit. */
function isZeroAmount(amount: string, currency: string): boolean {
  return compare(roundToCurrency(amount, currency), "0") === 0;
}

// ===== Normalization =====

export function normalizeResult(
  output: z.infer<typeof parserOutputSchema>,
  aiLanguage?: string
): NormalizedParseOutput {
  const title = normalizeTitle(output.title, fallbackTitleForOutcome(output, aiLanguage));
  const base = {
    title,
    receipt_count: output.receipt_count,
    reasoning: output.reasoning,
  };
  const invalid = (
    diagnostic: NonNullable<NormalizedParseOutput["internal_diagnostic"]>,
    reason?: string
  ): NormalizedParseOutput => ({
    ...base,
    outcome: "invalid",
    internal_diagnostic: diagnostic,
    // An invalid result made here keeps the title the model wrote for the document.
    ...(reason == null ? {} : { invalid_reason: reason }),
    receipt_totals: output.receipt_totals,
    ledger_entries: [],
    order_adjustments: [],
  });

  if (output.outcome === "invalid") {
    // The model's own refusal stands as written, its reason included, whatever rows it listed.
    return {
      ...base,
      outcome: "invalid",
      ...(output.invalid_reason != null ? { invalid_reason: output.invalid_reason } : {}),
      receipt_totals: output.receipt_totals,
      ledger_entries: output.ledger_entries.map(normalizeEntry),
      order_adjustments: output.order_adjustments,
    };
  }

  // A currency the ledger cannot convert is refused outright, never swapped for another.
  const unsupported = [
    ...new Set(
      [...output.ledger_entries, ...output.order_adjustments]
        .map((row) => row.currency)
        .filter((currency) => !supportedCurrencies.has(currency))
    ),
  ];
  if (unsupported.length > 0) {
    return invalid(
      "unsupported_currency",
      getAiOutputCopy(aiLanguage).unsupportedCurrency.replace(
        "{currencies}",
        unsupported.join(", ")
      )
    );
  }

  // A debit is frequently rendered with a minus sign in banking and app UIs.
  // For a successful expense parse the sign is presentation, not an expense direction.
  const ledgerEntries = output.ledger_entries
    .map((entry) => ({ ...entry, amount: normalizeSuccessfulExpenseAmount(entry.amount) }))
    // A zero row is a free item or a line the model should have left out; it records nothing.
    .filter((entry) => !isZeroAmount(entry.amount, entry.currency));
  if (output.ledger_entries.length > 0 && ledgerEntries.length === 0) {
    return invalid("non_positive_entry");
  }
  const receiptTotals = output.receipt_totals.map((total) => ({
    ...total,
    amount: normalizeSuccessfulExpenseAmount(total.amount),
  }));

  return {
    ...base,
    outcome: "success",
    ...(output.invalid_reason != null ? { invalid_reason: output.invalid_reason } : {}),
    receipt_totals: receiptTotals,
    ledger_entries: ledgerEntries.map(normalizeEntry),
    order_adjustments: output.order_adjustments.filter(
      (adjustment) => !isZeroAmount(adjustment.amount, adjustment.currency)
    ),
  };
}

function normalizeEntry(entry: ParsedOutput["ledger_entries"][number]): NormalizedLedgerEntry {
  return {
    receipt_index: entry.receipt_index,
    item_name: entry.item_name,
    amount: entry.amount,
    currency: entry.currency,
    category_index: entry.category_index,
    notes: entry.notes ?? null,
    date_hint: entry.date_hint ?? null,
    already_recorded: entry.already_recorded ?? null,
  };
}
