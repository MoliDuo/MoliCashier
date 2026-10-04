"use client";
import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, SquareCheckBig, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { cn } from "@/lib/utils";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { SelectAllToggle, selectionCountText } from "@/modules/ledger/ui/batch-action-toolbar";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { BookSwitcher } from "./BookSwitcher";
import { LIST_CONTROLS_ID } from "./ListControlsDrop";
import { ledgerPageCopy } from "@/copy/app";
import { batchActionsCopy } from "@/copy/workspace";
import { periodBarCopy } from "@/copy/controls";

// Narrow beside the summary, with the 44px a thumb needs.
const STEP_BUTTON_CLASS =
  "relative h-11 w-7 shrink-0 text-muted-foreground after:absolute after:inset-y-0 after:-inset-x-2 after:content-[''] md:hidden";

interface LedgerTopBarProps {
  activeTab: LedgerTab;
  disabled: boolean;
  /** The desktop tabs; phones carry them in the bottom bar instead. */
  navigation: ReactNode;
  onOpenInput: () => void;
  onInputIntent: () => void;
}

/**
 * The ledger's top bar. On a phone it is three parts: the list's select toggle
 * on the left, the page's summary in the middle (账目's or 明细's list, or 统计's
 * figures, which drops that page's period and filter down) between arrows that
 * step the period, and the book switcher on the right. While a list is being selected from, the middle is the
 * count and the right is select-all; 设置 has only its name, since the book
 * being viewed has no bearing there. From md up the bar holds the book switcher
 * on the left, then the tabs and 记账, and selecting stays in the page.
 */
export function LedgerTopBar({
  activeTab,
  disabled,
  navigation,
  onOpenInput,
  onInputIntent,
}: LedgerTopBarProps) {
  const inSettings = activeTab === "settings";
  const headerSummary = useWorkspaceStore((state) => state.headerSummary);
  const headerSelection = useWorkspaceStore((state) => state.headerSelection);
  const listControlsOpen = useWorkspaceStore((state) => state.listControlsOpen);
  const setListControlsOpen = useWorkspaceStore((state) => state.setListControlsOpen);
  const selecting = !inSettings && headerSelection?.active === true;

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1 md:flex-none md:gap-3",
          selecting ? "flex-none" : "flex-1"
        )}
      >
        {inSettings ? null : (
          <div className="hidden md:flex">
            <BookSwitcher disabled={disabled} align="start" />
          </div>
        )}
        {!inSettings && headerSelection != null ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground md:hidden"
            onClick={headerSelection.onToggle}
            disabled={disabled || headerSelection.disabled}
            aria-label={selecting ? batchActionsCopy.cancelSelect : batchActionsCopy.select}
            title={selecting ? batchActionsCopy.cancelSelect : batchActionsCopy.select}
          >
            {selecting ? (
              <X className="size-5" aria-hidden="true" />
            ) : (
              <SquareCheckBig className="size-5" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </div>
      {/* A phone's bar has no tabs, so the page's name or summary sits in the
          middle; the two sides share the rest equally, which keeps it centred.
          The list's period and filter controls fold into the summary. */}
      {inSettings ? (
        <h1 className={textRoleClassName("sectionTitle", "shrink-0 md:sr-only")}>
          {ledgerPageCopy.settings}
        </h1>
      ) : selecting && headerSelection != null ? (
        <p
          aria-live="polite"
          className={textRoleClassName(
            "bodyStrong",
            "min-w-0 flex-1 truncate text-center tabular-nums md:hidden"
          )}
        >
          {selectionCountText({
            selectedCount: headerSelection.selectedCount,
            loadedCount: headerSelection.loadedCount,
            hasMoreData: headerSelection.hasMore,
          })}
        </p>
      ) : headerSummary != null ? (
        <>
          {headerSummary.steps != null ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={STEP_BUTTON_CLASS}
              disabled={disabled || !headerSummary.steps.back}
              onClick={() => headerSummary.onStep(-1)}
              aria-label={periodBarCopy.previous}
              title={periodBarCopy.previous}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          ) : null}
          <button
            type="button"
            aria-expanded={listControlsOpen}
            aria-controls={LIST_CONTROLS_ID}
            onClick={() => setListControlsOpen(!listControlsOpen)}
            className="flex min-w-0 max-w-[40vw] shrink-0 flex-col items-center rounded-md px-2 py-0.5 transition-colors hover:bg-surface2 md:hidden"
          >
            <span
              className={textRoleClassName(
                "micro",
                cn(
                  "flex max-w-full items-center gap-0.5 whitespace-nowrap",
                  headerSummary.filtered && "text-primary"
                )
              )}
            >
              <span className="truncate">
                {headerSummary.filtered
                  ? `${headerSummary.period} · ${ledgerPageCopy.filtered}`
                  : headerSummary.period}
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  listControlsOpen && "rotate-180"
                )}
              />
            </span>
            <AmountText variant="summary" className="whitespace-nowrap">
              {headerSummary.total ?? ledgerPageCopy.totalPending}
            </AmountText>
          </button>
          {headerSummary.steps != null ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={STEP_BUTTON_CLASS}
              disabled={disabled || !headerSummary.steps.forward}
              onClick={() => headerSummary.onStep(1)}
              aria-label={periodBarCopy.next}
              title={periodBarCopy.next}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
        </>
      ) : null}
      <div className="hidden h-full flex-1 justify-center md:flex">{navigation}</div>
      <div
        className={cn(
          "flex min-w-0 items-center justify-end gap-1 md:flex-none md:gap-2",
          selecting ? "flex-none" : "flex-1"
        )}
      >
        <Button
          type="button"
          size="sm"
          className="hidden gap-1.5 md:inline-flex"
          onClick={onOpenInput}
          onPointerEnter={onInputIntent}
          onFocus={onInputIntent}
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden="true" />
          {ledgerPageCopy.newRecord}
        </Button>
        {inSettings ? null : (
          <div className={cn("flex min-w-0 justify-end md:hidden", selecting && "max-md:hidden")}>
            <BookSwitcher disabled={disabled} />
          </div>
        )}
        {selecting && headerSelection != null ? (
          <SelectAllToggle
            className="min-h-11 shrink-0 px-2 md:hidden"
            checked={headerSelection.allSelected}
            disabled={disabled || headerSelection.disabled}
            onToggle={headerSelection.onToggleAll}
          />
        ) : null}
      </div>
    </>
  );
}
