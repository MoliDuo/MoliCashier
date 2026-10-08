"use client";

import { useState } from "react";
import { CopyCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { openLedgerDetail } from "@/modules/ledger/navigation/ledger-detail-navigation";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { DISPLAY_LOCALE } from "@/lib/constants";
import type { DuplicateSuggestionDto } from "../contracts";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface Props {
  suggestion: DuplicateSuggestionDto;
  disabled: boolean;
  onApply: (suggestionId: string) => Promise<unknown>;
  onDismiss: (suggestionId: string) => Promise<unknown>;
}

const copy = sourceDocumentDetailCopy.duplicateSuggestion;

/**
 * The parse found rows the ledger already holds. They stay on the record until
 * the owner removes them here, the same confirm-or-dismiss shape as the date
 * suggestion beside it.
 */
export function SourceDocumentDuplicateSuggestion({
  suggestion,
  disabled,
  onApply,
  onDismiss,
}: Props) {
  const [failed, setFailed] = useState(false);
  const run = (action: (suggestionId: string) => Promise<unknown>) => {
    setFailed(false);
    void action(suggestion.id).catch(() => setFailed(true));
  };

  return (
    <section
      className="overflow-hidden rounded-lg border border-warning/30 bg-warning/5"
      aria-label={copy.title}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/15 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CopyCheck aria-hidden="true" className="size-4 shrink-0" />
          <span className={textRoleClassName("cardTitle", "min-w-0 truncate")}>{copy.title}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => run(onDismiss)}>
            {copy.keep}
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => run(onApply)}>
            {suggestion.coversWholeDocument ? copy.removeWhole : copy.remove}
          </Button>
        </div>
      </header>
      {failed ? (
        <p
          className={textRoleClassName(
            "meta",
            "border-b border-danger/20 bg-danger/5 px-3 py-2 text-danger"
          )}
          role="alert"
        >
          {copy.applyFailed}
        </p>
      ) : null}
      <ul className="divide-y divide-warning/15 px-3">
        {suggestion.items.map((item) => (
          <li key={item.ledgerEntryId} className="flex items-center justify-between gap-3 py-1">
            <p className={textRoleClassName("body", "min-w-0 truncate")}>
              {item.itemName}
              <span className="ml-2 tabular-nums">
                {formatCurrencyAmount(item.amount, item.currency, DISPLAY_LOCALE)}
              </span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLedgerDetail(item.matched.sourceDocumentId)}
            >
              {copy.view}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
