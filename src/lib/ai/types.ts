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

/**
 * One evidence image as the model receives it: whole, or a tall screenshot cut top to bottom into
 * parts that overlap by `overlapPx` rows, so none of them is shrunk past legibility.
 */
export type EvidenceImage = { dataUrl: string } | { parts: readonly string[]; overlapPx: number };
