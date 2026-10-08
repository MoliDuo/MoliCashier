/**
 * One evidence image as the model receives it: whole, or a tall screenshot cut top to bottom into
 * parts that overlap by `overlapPx` rows, so none of them is shrunk past legibility.
 */
export type EvidenceImage = { dataUrl: string } | { parts: readonly string[]; overlapPx: number };
