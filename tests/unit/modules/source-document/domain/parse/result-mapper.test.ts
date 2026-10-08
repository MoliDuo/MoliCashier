import { describe, it, expect } from "vitest";
import { ProcessingCancelledError } from "@/modules/source-document/domain/parse/contracts";
import type { ParsePipelineResult } from "@/modules/source-document/domain/parse/pipeline";
import {
  convertToParsedEntries,
  toParseSourceDocumentOutput,
} from "@/modules/source-document/domain/parse/result-mapper";
import type {
  NormalizedLedgerEntry,
  NormalizedOrderAdjustment,
} from "@/modules/source-document/domain/parse/parser-schema";

describe("convertToParsedEntries", () => {
  const item = (
    category_index = 1,
    receipt_index = 0,
    currency: NormalizedLedgerEntry["currency"] = "MYR"
  ): NormalizedLedgerEntry => ({
    receipt_index,
    item_name: "Meal",
    amount: "30",
    currency,
    category_index,
    notes: "Original price",
  });
  const adjustment = (
    amount: string,
    category_index = 0,
    receipt_index = 0,
    currency: NormalizedOrderAdjustment["currency"] = "MYR"
  ): NormalizedOrderAdjustment => ({
    receipt_index,
    item_name: "Adjustment",
    amount,
    currency,
    category_index,
  });

  it("preserves product prices and records shipping and discount in the shared category", () => {
    const result = convertToParsedEntries({
      ledgerEntries: [item()],
      orderAdjustments: [adjustment("5"), adjustment("-8")],
    });
    expect(result.map((e) => [e.amount, e.categoryIndex, e.isAdjustment])).toEqual([
      ["30.00", 1, false],
      ["5.00", 1, true],
      ["-8.00", 1, true],
    ]);
    expect(result[0]).toMatchObject({
      notes: "Original price",
      entryDate: null,
      receiptIndex: 0,
      currency: "MYR",
    });
  });
  it("keeps mixed-category adjustments uncategorized unless explicitly attributed", () => {
    const result = convertToParsedEntries({
      ledgerEntries: [item(1), item(2)],
      orderAdjustments: [adjustment("5"), adjustment("-8", 2)],
    });
    expect(result.slice(2).map((e) => e.categoryIndex)).toEqual([0, 2]);
  });

  it("keeps an explicit adjustment category when the receipt has one product category", () => {
    const result = convertToParsedEntries({
      ledgerEntries: [item(1)],
      orderAdjustments: [adjustment("5", 2)],
    });

    expect(result[1]?.categoryIndex).toBe(2);
  });
  it("inherits a receipt date hint only when every product row agrees", () => {
    const sharedHint = { kind: "relative" as const, value: "yesterday", sourceText: "昨天" };
    const result = convertToParsedEntries({
      ledgerEntries: [{ ...item(), date_hint: sharedHint }],
      orderAdjustments: [adjustment("5")],
    });
    expect(result[1]?.dateHint).toEqual(sharedHint);

    const mixedResult = convertToParsedEntries({
      ledgerEntries: [
        { ...item(), date_hint: sharedHint },
        {
          ...item(1, 0, "MYR"),
          date_hint: { kind: "relative", value: "today", sourceText: "今天" },
        },
      ],
      orderAdjustments: [adjustment("5")],
    });
    expect(mixedResult[2]?.dateHint).toBeUndefined();
  });
  it("isolates categories by receipt and preserves each row's own currency precision", () => {
    const result = convertToParsedEntries({
      ledgerEntries: [item(1, 0, "JPY"), item(2, 1, "USD")],
      orderAdjustments: [adjustment("-1", 0, 0, "JPY"), adjustment("-0.12", 0, 1, "USD")],
    });
    expect(result.map((e) => [e.amount, e.currency, e.categoryIndex])).toEqual([
      ["30", "JPY", 1],
      ["30.00", "USD", 2],
      ["-1", "JPY", 1],
      ["-0.12", "USD", 2],
    ]);
  });
  it("does not discard unmatched charges, invent categories, or retain zero adjustments", () => {
    const result = convertToParsedEntries({
      ledgerEntries: [item(0)],
      orderAdjustments: [adjustment("0"), adjustment("5", 0, 1, "USD")],
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      amount: "5.00",
      currency: "USD",
      categoryIndex: 0,
      receiptIndex: 1,
    });
  });
});

describe("toParseSourceDocumentOutput", () => {
  it("maps success results to passed output", () => {
    const result: ParsePipelineResult = {
      kind: "success",
      title: "Receipt",
      ledgerEntries: [],
    };

    expect(toParseSourceDocumentOutput(result)).toEqual({
      ledgerEntries: [],
      title: "Receipt",
      verificationStatus: "passed",
    });
  });

  it("maps invalid results to invalid output with title and reason", () => {
    const result: ParsePipelineResult = {
      kind: "invalid",
      title: "Blurred receipt",
      reason: "Results inconsistent",
      diagnostic: "ai_declared_invalid",
    };

    expect(toParseSourceDocumentOutput(result)).toEqual({
      ledgerEntries: [],
      title: "Blurred receipt",
      reason: "Results inconsistent",
      diagnostic: "ai_declared_invalid",
      verificationStatus: "invalid",
    });
  });

  it("omits the reason when the pipeline found none", () => {
    const result: ParsePipelineResult = {
      kind: "invalid",
      title: "Blurred receipt",
      diagnostic: "entry_validation_failed",
    };

    expect(toParseSourceDocumentOutput(result)).toEqual({
      ledgerEntries: [],
      title: "Blurred receipt",
      diagnostic: "entry_validation_failed",
      verificationStatus: "invalid",
    });
  });

  it("throws when pipeline reports cancellation", () => {
    const result: ParsePipelineResult = { kind: "cancelled" };

    expect(() => toParseSourceDocumentOutput(result)).toThrow(ProcessingCancelledError);
  });
});
