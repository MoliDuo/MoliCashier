import type { DateHint } from "./date-organization";

export interface ParsedLedgerEntry {
  itemName: string;
  amount: string; // canonical decimal string, e.g. "45.00"
  currency: string | null;
  categoryIndex: number; // 0 = no category, 1+ = index into categories array
  entryDate: string | null; // YYYY-MM-DD 格式
  notes?: string | null; // Consolidated notes
  receiptIndex?: number; // index of receipt within multi-receipt document
  isAdjustment?: boolean; // true for order_adjustments rows (discounts, fees, etc.)
  dateHint?: DateHint;
  /** The handle of a recently recorded entry the row repeats, as the parse named it. */
  alreadyRecorded?: string;
}

export interface CategoryInfo {
  id: string;
  name: string;
  description: string | null;
}
