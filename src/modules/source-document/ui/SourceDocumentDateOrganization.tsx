"use client";

import { useMemo, useState } from "react";
import { CalendarSync, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { DateFilter } from "@/components/ui/date-filter";
import { formatDateTimeForApi } from "@/lib/date-utils";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";
import type { DateOrganizationSuggestion } from "@/lib/source-document/suggestions";
import type { ApplyDateOrganizationInput } from "../contracts";
import { EditableLedgerEntryItem } from "./EditableLedgerEntryItem";
import { buildSourceDocumentDetailViewModel } from "./source-document-detail-view-model";
import { SourceDocumentTotal } from "./SourceDocumentViewDetails/components/SourceDocumentTotal";
import { sourceDocumentDetailCopy } from "@/copy/source-document";

interface Props {
  suggestion: DateOrganizationSuggestion;
  entries: LedgerEntryEmbeddedViewDto[];
  mainCurrency?: string;
  disabled: boolean;
  onApply: (input: Omit<ApplyDateOrganizationInput, "sourceDocumentId">) => Promise<unknown>;
  onDismiss: (suggestionId: string) => Promise<unknown>;
  onAdjustmentStateChange?: (active: boolean, dirty: boolean) => void;
  /** Ledger timezone, so 今天/昨天 match the dates the ledger stream groups by. */
  timeZone?: string;
}

export function SourceDocumentDateOrganization({
  suggestion,
  entries,
  mainCurrency = "CNY",
  disabled,
  onApply,
  onDismiss,
  onAdjustmentStateChange,
  timeZone,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [applicationError, setApplicationError] = useState(false);
  const suggestionByEntryId = useMemo(
    () => new Map(suggestion.items.map((item) => [item.ledgerEntryId, item])),
    [suggestion.items]
  );
  // An entry is missing from the suggestion exactly when the model could not put
  // a date on it; those sit on the bill date like anything else the suggestion
  // does not move, and are not called out — the panel only ever proposes dates.
  const initialDates = () =>
    Object.fromEntries(
      entries.map((entry) => [
        entry.id,
        suggestionByEntryId.get(entry.id)?.resolvedDate ?? suggestion.sourceDocumentDate,
      ])
    );
  const [dates, setDates] = useState<Record<string, string>>(initialDates);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  // The date is the group key, so moving a group onto a date another group
  // already holds merges the two. Splitting a group back apart is deliberately
  // not offered: dates are edited per group, never per entry.
  const groups = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      const date = dates[entry.id] ?? suggestion.sourceDocumentDate;
      grouped.set(date, [...(grouped.get(date) ?? []), entry.id]);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([entryDate, ledgerEntryIds]) => ({ id: entryDate, entryDate, ledgerEntryIds }));
  }, [dates, entries, suggestion.sourceDocumentDate]);
  // Each group carries the total of the entries it holds, read through the same
  // view model the entry card below uses, so the figure the suggestion proposes
  // and the figure that lands on the record can be compared line for line.
  const groupSummaries = useMemo(
    () =>
      groups.map((group) => {
        const groupEntries = group.ledgerEntryIds
          .map((id) => entryById.get(id))
          .filter((entry): entry is LedgerEntryEmbeddedViewDto => entry != null);
        const { totalInMainCurrency, staleConversionCount, unconvertedCount } =
          buildSourceDocumentDetailViewModel({
            ledgerEntries: groupEntries,
            pendingChanges: { entries: {} },
            mainCurrency,
            entryDate: suggestion.sourceDocumentDate,
            originalEntryDate: suggestion.sourceDocumentDate,
          });
        return { group, totalInMainCurrency, staleConversionCount, unconvertedCount };
      }),
    [groups, entryById, mainCurrency, suggestion.sourceDocumentDate]
  );
  /**
   * Apply every group at once. Groups are never applied individually: the
   * panel's only paths are adjusting the dates and then applying the whole
   * suggestion.
   */
  const applyAll = async () => {
    setApplicationError(false);
    try {
      await onApply({
        suggestionId: suggestion.id,
        groups,
        appliedGroupIds: groups.map((group) => group.id),
      });
      setEditing(false);
      setDirty(false);
      onAdjustmentStateChange?.(false, false);
    } catch {
      setApplicationError(true);
    }
  };

  const setGroupDate = (ledgerEntryIds: string[], next: string) => {
    // A cleared field is a half-typed edit, not a request to drop the date.
    if (next === "") return;
    setDates((current) => {
      const updated = { ...current };
      for (const id of ledgerEntryIds) updated[id] = next;
      return updated;
    });
    setDirty(true);
    onAdjustmentStateChange?.(true, true);
  };

  const resetDraft = () => {
    setEditing(false);
    setDates(initialDates());
    setDirty(false);
    setApplicationError(false);
    onAdjustmentStateChange?.(false, false);
  };

  const doneAdjusting = () => {
    setEditing(false);
    onAdjustmentStateChange?.(false, dirty);
  };

  return (
    <section
      className="overflow-hidden rounded-lg border border-info/30 bg-info/5"
      aria-label={sourceDocumentDetailCopy.dateOrganization.title}
    >
      {/* The box around the whole suggestion wears the same tint as the groups
          inside it, so the block reads as one suggestion rather than a white
          card holding green ones. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-info/15 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Marks the block as a feature, not another line of the record. Drawn
              in the title's own colour, like every other icon in the app. */}
          <CalendarSync aria-hidden="true" className="size-4 shrink-0" />
          <span className={textRoleClassName("cardTitle", "min-w-0 truncate")}>
            {sourceDocumentDetailCopy.dateOrganization.title}
          </span>
        </div>
        <div className="flex gap-1">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={resetDraft}>
                <X className="size-3.5" />
                {sourceDocumentDetailCopy.dateOrganization.cancel}
              </Button>
              <Button size="sm" onClick={doneAdjusting}>
                <Check className="size-3.5" />
                {sourceDocumentDetailCopy.dateOrganization.done}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setApplicationError(false);
                  void onDismiss(suggestion.id)
                    .then(() => onAdjustmentStateChange?.(false, false))
                    .catch(() => setApplicationError(true));
                }}
              >
                {sourceDocumentDetailCopy.dateOrganization.dismiss}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setEditing(true);
                  onAdjustmentStateChange?.(true, false);
                }}
              >
                <Pencil className="size-3.5" />
                {sourceDocumentDetailCopy.dateOrganization.adjust}
              </Button>
              <Button
                size="sm"
                disabled={disabled || groups.length === 0}
                onClick={() => void applyAll()}
              >
                {sourceDocumentDetailCopy.dateOrganization.applyAll}
              </Button>
            </>
          )}
        </div>
      </header>
      {applicationError ? (
        <p
          className={textRoleClassName(
            "meta",
            "border-b border-danger/20 bg-danger/5 px-3 py-2 text-danger"
          )}
          role="alert"
        >
          {sourceDocumentDetailCopy.dateOrganization.applyFailed}
        </p>
      ) : null}
      {/* One card per date, inset from the box and spaced at the app's card gap. */}
      <div className="space-y-4 p-3">
        {groupSummaries.map(
          ({ group, totalInMainCurrency, staleConversionCount, unconvertedCount }) => (
            <div
              key={group.id}
              className="overflow-hidden rounded-lg border border-info/30 bg-info/5"
            >
              {/* The entry card the rows below will become, down to the centred
                date and the right-aligned total — the select control is the one
                part a proposal has no use for. */}
              <div
                data-testid="date-organization-group-header"
                className="relative flex min-h-12 min-w-0 items-center justify-between gap-2 border-b border-info/15 py-2 pl-2 pr-3"
              >
                <div className="relative z-10 flex shrink-0 items-center gap-2" />
                <div className="flex min-w-0 items-center gap-2 sm:absolute sm:left-1/2 sm:top-1/2 sm:max-w-[55%] sm:-translate-x-1/2 sm:-translate-y-1/2">
                  {/* The date field the bill's own toolbar uses, so adjusting a
                      group and adjusting the record are the same gesture. It is
                      static text until 调整 turns it into the picker. */}
                  <DateFilter
                    value={group.entryDate}
                    onChange={(date) => {
                      if (date != null) {
                        setGroupDate(group.ledgerEntryIds, formatDateTimeForApi(date));
                      }
                    }}
                    size="sm"
                    className="min-w-fit shrink-0"
                    truncate={false}
                    showClear={false}
                    showClearShortcut={false}
                    readOnly={!editing}
                    readOnlyTextClassName="font-medium"
                    hideReadOnlyIcon
                    ariaLabel={sourceDocumentDetailCopy.dateOrganization.groupDate}
                    {...(timeZone != null ? { timeZone } : {})}
                  />
                </div>
                <SourceDocumentTotal
                  totalInMainCurrency={totalInMainCurrency}
                  mainCurrency={mainCurrency}
                  staleConversionCount={staleConversionCount}
                  unconvertedCount={unconvertedCount}
                />
              </div>
              <div className="divide-y divide-info/15">
                {group.ledgerEntryIds.map((id) => {
                  const entry = entryById.get(id);
                  if (entry == null) return null;
                  return (
                    // The same row the line-item list renders, in read-only mode.
                    <EditableLedgerEntryItem
                      key={id}
                      ledgerEntry={entry}
                      categories={entry.category != null ? [entry.category] : []}
                      mainCurrency={mainCurrency}
                      sourceDocumentEntryDate={suggestion.sourceDocumentDate}
                      originalEntryDate={suggestion.sourceDocumentDate}
                      readOnly
                      variant="plain"
                    />
                  );
                })}
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}
