import Decimal from "decimal.js";
import { vi } from "vitest";

interface MockEntryData {
  item_name: string;
  amount: string;
  currency?: string;
  category_index?: number;
  entry_date?: string | null;
  notes?: string | null;
}

export interface OpenAIMockOptions {
  currencies?: string[];
  categories?: string[];
  title?: string;
  entries?: MockEntryData[];
}

const DEFAULT_OPTIONS: Required<OpenAIMockOptions> = {
  currencies: ["CNY"],
  categories: ["餐饮"],
  title: "测试账单",
  entries: [
    {
      item_name: "午餐",
      amount: "25.50",
      currency: "CNY",
      category_index: 1,
      entry_date: "2026-09-05",
      notes: null,
    },
  ],
};

/** A transport that answers with the current parser protocol. */
export function createOpenAIMock(options: OpenAIMockOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    complete: vi.fn().mockImplementation(() => {
      const entries = opts.entries.map((entry, index) => ({
        receipt_index: 0,
        item_name: entry.item_name,
        amount: entry.amount,
        currency: entry.currency ?? opts.currencies[0] ?? "CNY",
        category_index: entry.category_index ?? index + 1,
        notes: entry.notes ?? null,
      }));
      const totalAmount = entries.reduce(
        (sum, entry) => new Decimal(sum).plus(entry.amount).toFixed(),
        "0"
      );
      const currency = opts.currencies[0] ?? "CNY";

      return Promise.resolve({
        content: JSON.stringify({
          outcome: "success",
          title: opts.title,
          receipt_count: 1,
          receipt_totals: [{ receipt_index: 0, amount: totalAmount, currency }],
          ledger_entries: entries,
          order_adjustments: [],
          reasoning: `Parsed entries using ${opts.categories.join(", ")}`,
        }),
        usage: { promptTokens: 200, completionTokens: 100 },
      });
    }),
  };
}
