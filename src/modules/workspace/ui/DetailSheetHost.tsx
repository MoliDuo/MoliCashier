"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { BookDto, EntryCategoryDto } from "@/modules/ledger/contracts";
import {
  closeLedgerDetail,
  restoreDetailReturnFocus,
} from "@/modules/ledger/navigation/ledger-detail-navigation";
import { DetailSheetLoadingFallback } from "./DetailSheetLoadingFallback";

const SourceDocumentDetailModal = dynamic(
  () =>
    import("@/modules/source-document/ui/SourceDocumentDetailModal").then((module) => ({
      default: module.SourceDocumentDetailModal,
    })),
  { ssr: false, loading: () => <DetailSheetLoadingFallback /> }
);

interface DetailSheetHostProps {
  /** The record the URL names, or null when none is open. */
  detailId: string | null;
  /** The live books, so an open record can be moved between them. */
  books: readonly BookDto[];
  categories: EntryCategoryDto[];
  mainCurrency: string;
  preferredCurrencies: string[];
  timeZone: string;
}

/**
 * Renders the record the URL names. The URL is the only record of what is
 * open: closing rewrites it, and the sheet it named stays mounted just long
 * enough to animate out.
 */
export function DetailSheetHost({ detailId, ...props }: DetailSheetHostProps) {
  const [shownId, setShownId] = useState(detailId);
  if (detailId != null && detailId !== shownId) setShownId(detailId);
  if (shownId == null) return null;

  return (
    <SourceDocumentDetailModal
      key={shownId}
      id={shownId}
      open={detailId === shownId}
      onClose={closeLedgerDetail}
      onExitComplete={() => {
        setShownId((current) => (current === shownId && detailId == null ? null : current));
        if (detailId == null) restoreDetailReturnFocus();
      }}
      {...props}
    />
  );
}
