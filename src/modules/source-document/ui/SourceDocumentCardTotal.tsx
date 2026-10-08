import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { memo, useMemo } from "react";

import { formatCurrencyAmount } from "@/lib/format/currency";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { calculateSourceDocumentCardTotal } from "./source-document-card.utils";
import { DISPLAY_LOCALE } from "@/lib/constants";

interface SourceDocumentCardTotalProps {
  entries: LedgerEntryDto[];
  mainCurrency: string;
}

export const SourceDocumentCardTotal = memo(function SourceDocumentCardTotal({
  entries,
  mainCurrency,
}: SourceDocumentCardTotalProps) {
  const locale = DISPLAY_LOCALE;
  const total = useMemo(
    () => calculateSourceDocumentCardTotal(entries, mainCurrency),
    [entries, mainCurrency]
  );

  return (
    <AmountText variant="item">{formatCurrencyAmount(total, mainCurrency, locale)}</AmountText>
  );
});
