import { describe, expect, it } from "vitest";
import {
  normalizeResult,
  parserOutputSchema,
} from "@/modules/source-document/domain/parse/parser-schema";

const simpleSuccess = {
  outcome: "success",
  title: "Coffee",
  receipt_count: 1,
  receipt_totals: [{ receipt_index: 0, amount: "12.50", currency: "USD" }],
  ledger_entries: [
    {
      receipt_index: 0,
      item_name: "Coffee",
      amount: "12.50",
      currency: "USD",
      category_index: 1,
      notes: null,
    },
  ],
  order_adjustments: [],
  reasoning: "single item",
};

describe("parser-schema", () => {
  it("normalizes optional strings and preserves receipt-adjustment structure", () => {
    const parsed = normalizeResult(parserOutputSchema.parse(simpleSuccess));
    expect(parsed.ledger_entries[0]?.receipt_index).toBe(0);
    expect(parsed.order_adjustments).toEqual([]);
  });

  it("normalizes null notes to null", () => {
    const parsed = normalizeResult(parserOutputSchema.parse(simpleSuccess));
    expect(parsed.ledger_entries[0]?.notes).toBeNull();
  });

  it("normalizes missing title to a non-empty fallback string", () => {
    const noTitle = { ...simpleSuccess };
    const { title: _t, ...withoutTitle } = noTitle;
    const parsed = normalizeResult(parserOutputSchema.parse(withoutTitle));
    expect(parsed.title).toBe("Untitled document");
  });

  it("uses invalid-content fallback title for invalid results missing title", () => {
    const parsed = normalizeResult(
      parserOutputSchema.parse({
        ...simpleSuccess,
        outcome: "invalid",
        title: null,
        ledger_entries: [],
        receipt_totals: [],
      })
    );
    expect(parsed.title).toBe("Invalid content");
  });

  it("uses invalid-content fallback title for invalid results with a reason", () => {
    const parsed = normalizeResult(
      parserOutputSchema.parse({
        ...simpleSuccess,
        outcome: "invalid",
        title: "   ",
        invalid_reason: "Image too blurry",
        ledger_entries: [],
        receipt_totals: [],
      })
    );
    expect(parsed.title).toBe("Invalid content");
  });

  it("uses a localized fallback title for the target AI language", () => {
    const parsed = normalizeResult(
      parserOutputSchema.parse({ ...simpleSuccess, title: null }),
      "zh-CN"
    );

    expect(parsed.title).toBe("未命名单据");
  });

  it("drops a zero-amount row and keeps the rest of the receipt", () => {
    const result = normalizeResult(
      parserOutputSchema.parse({
        ...simpleSuccess,
        ledger_entries: [
          simpleSuccess.ledger_entries[0]!,
          { ...simpleSuccess.ledger_entries[0]!, item_name: "Free gift", amount: "0.00" },
          // Nothing once rounded to the currency's cents.
          { ...simpleSuccess.ledger_entries[0]!, item_name: "Rounding", amount: "0.001" },
        ],
        order_adjustments: [
          { receipt_index: 0, item_name: "Discount", amount: "0", currency: "USD" },
          { receipt_index: 0, item_name: "Tip", amount: "1.00", currency: "USD" },
        ],
      })
    );

    expect(result.outcome).toBe("success");
    expect(result.ledger_entries.map((entry) => entry.item_name)).toEqual(["Coffee"]);
    expect(result.order_adjustments.map((adjustment) => adjustment.item_name)).toEqual(["Tip"]);
  });

  it("turns a receipt whose every row is zero into an invalid result", () => {
    const withZeroEntry = parserOutputSchema.parse({
      ...simpleSuccess,
      ledger_entries: [{ ...simpleSuccess.ledger_entries[0]!, amount: "0" }],
    });
    const result = normalizeResult(withZeroEntry);
    expect(result.outcome).toBe("invalid");
    expect(result.internal_diagnostic).toBe("non_positive_entry");
    // The AI-facing reason stays untouched: the internal label is not user copy.
    expect(result.invalid_reason).toBeUndefined();
  });

  it("keeps the model's reason for an invalid result whose rows are negative", () => {
    const result = normalizeResult(
      parserOutputSchema.parse({
        ...simpleSuccess,
        outcome: "invalid",
        invalid_reason: "This is a refund, not an expense.",
        ledger_entries: [{ ...simpleSuccess.ledger_entries[0]!, amount: "-12.50" }],
      })
    );

    expect(result.outcome).toBe("invalid");
    expect(result.invalid_reason).toBe("This is a refund, not an expense.");
    expect(result.internal_diagnostic).toBeUndefined();
  });

  it("accepts any ISO currency code and refuses one the ledger does not support, saying which", () => {
    const parsed = parserOutputSchema.parse({
      ...simpleSuccess,
      ledger_entries: [{ ...simpleSuccess.ledger_entries[0]!, currency: " vnd " }],
    });
    expect(parsed.ledger_entries[0]?.currency).toBe("VND");

    const result = normalizeResult(parsed, "zh-CN");
    expect(result.outcome).toBe("invalid");
    expect(result.internal_diagnostic).toBe("unsupported_currency");
    expect(result.invalid_reason).toBe("这张单据使用的币种（VND）暂不支持记账。");
    expect(result.ledger_entries).toEqual([]);
    // The model's title for the document stays.
    expect(result.title).toBe("Coffee");
  });

  it("refuses an unsupported currency on an adjustment too", () => {
    const result = normalizeResult(
      parserOutputSchema.parse({
        ...simpleSuccess,
        order_adjustments: [{ receipt_index: 0, item_name: "Fee", amount: "1", currency: "XYZ" }],
      }),
      "en-US"
    );
    expect(result.internal_diagnostic).toBe("unsupported_currency");
    expect(result.invalid_reason).toContain("XYZ");
  });

  it("still rejects a currency that is not a three-letter code", () => {
    const result = parserOutputSchema.safeParse({
      ...simpleSuccess,
      ledger_entries: [{ ...simpleSuccess.ledger_entries[0]!, currency: "RM" }],
    });
    expect(result.success).toBe(false);
  });

  it("normalizes a negative ledger entry and receipt total used as debit-display notation", () => {
    const withNegativeEntry = parserOutputSchema.parse({
      ...simpleSuccess,
      receipt_totals: [{ receipt_index: 0, amount: "-5", currency: "USD" }],
      ledger_entries: [{ ...simpleSuccess.ledger_entries[0]!, amount: "-5" }],
    });
    const result = normalizeResult(withNegativeEntry);
    expect(result.outcome).toBe("success");
    expect(result.receipt_totals[0]?.amount).toBe("5");
    expect(result.ledger_entries[0]?.amount).toBe("5");
  });

  it("rejects unquoted numeric amounts (schema-invalid outcome)", () => {
    const unquoted = {
      ...simpleSuccess,
      ledger_entries: [
        {
          receipt_index: 0,
          item_name: "Coffee",
          amount: 12.5, // unquoted JSON number
          currency: "USD",
          category_index: 1,
          notes: null,
        },
      ],
    };
    const result = parserOutputSchema.safeParse(unquoted);
    expect(result.success).toBe(false);
  });

  it("rejects exponent notation in amount strings", () => {
    const exponentEntry = {
      ...simpleSuccess,
      ledger_entries: [
        {
          ...simpleSuccess.ledger_entries[0]!,
          amount: "1e2",
        },
      ],
    };
    const result = parserOutputSchema.safeParse(exponentEntry);
    expect(result.success).toBe(false);
  });

  describe("already_recorded", () => {
    it("defaults to null for an entry and an adjustment that do not carry it", () => {
      const parsed = normalizeResult(
        parserOutputSchema.parse({
          ...simpleSuccess,
          order_adjustments: [
            { receipt_index: 0, item_name: "Shipping", amount: "2.00", currency: "USD" },
          ],
        })
      );

      expect(parsed.ledger_entries[0]?.already_recorded).toBeNull();
      expect(parsed.order_adjustments[0]?.already_recorded ?? null).toBeNull();
    });

    it("keeps the handle on an entry and an adjustment", () => {
      const parsed = normalizeResult(
        parserOutputSchema.parse({
          ...simpleSuccess,
          ledger_entries: [{ ...simpleSuccess.ledger_entries[0], already_recorded: " R3 " }],
          order_adjustments: [
            {
              receipt_index: 0,
              item_name: "Shipping",
              amount: "2.00",
              currency: "USD",
              already_recorded: "R4",
            },
          ],
        })
      );

      expect(parsed.ledger_entries[0]?.already_recorded).toBe("R3");
      expect(parsed.order_adjustments[0]?.already_recorded).toBe("R4");
    });

    it("reads a malformed handle as none instead of failing the parse", () => {
      const parsed = normalizeResult(
        parserOutputSchema.parse({
          ...simpleSuccess,
          ledger_entries: [{ ...simpleSuccess.ledger_entries[0], already_recorded: 3 }],
        })
      );

      expect(parsed.ledger_entries[0]?.already_recorded).toBeNull();
    });
  });
});
