"use client";
import { BarChart3, ClipboardList, Plus, ReceiptText, RefreshCw, Settings } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { LEDGER_ROUTES, type LedgerTab } from "@/modules/workspace/ledger-tabs";
import { ledgerPageCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";

interface TabNavigationProps {
  /** The bar along the bottom of a phone, or the tabs inside the desktop top bar. */
  variant: "bottom" | "top";
  disabled?: boolean;
  activeTab: LedgerTab;
  /** The open tab is reading again after a tap on it. */
  refreshing?: boolean;
  /** Called with the open tab too: a tap on it refreshes it. */
  onTabChange: (tab: LedgerTab) => void;
  /** Opens 记账; the bottom bar carries it between the tabs. */
  onOpenInput?: () => void;
  onInputIntent?: () => void;
  /** Called when an inactive destination receives pointer or keyboard focus. */
  onTabIntent?: (tab: LedgerTab) => void;
}

const TAB_ICONS: Record<LedgerTab, typeof ReceiptText> = {
  records: ReceiptText,
  entries: ClipboardList,
  stats: BarChart3,
  settings: Settings,
};

const TAB_LABELS: Record<LedgerTab, string> = {
  records: ledgerPageCopy.records,
  entries: ledgerPageCopy.entries,
  stats: ledgerPageCopy.stats,
  settings: ledgerPageCopy.settings,
};

/**
 * 账目, 明细, 统计 and 设置; a phone's bar carries 记账 between the first two and
 * the rest. Tapping the open tab refreshes it, and its icon turns while it does.
 */
export function TabNavigation({
  variant,
  disabled = false,
  activeTab,
  refreshing = false,
  onTabChange,
  onOpenInput,
  onInputIntent,
  onTabIntent,
}: TabNavigationProps) {
  const tab = (value: LedgerTab) => (
    <NavButton
      key={value}
      variant={variant}
      disabled={disabled}
      active={activeTab === value}
      refreshing={refreshing && activeTab === value}
      icon={TAB_ICONS[value]}
      label={TAB_LABELS[value]}
      onClick={() => onTabChange(value)}
      onIntent={onTabIntent != null && value !== activeTab ? () => onTabIntent(value) : undefined}
    />
  );

  if (variant === "top") {
    return (
      <nav aria-label={ledgerPageCopy.navigation} className="flex h-full items-stretch gap-1">
        {LEDGER_ROUTES.map(tab)}
      </nav>
    );
  }

  return (
    <nav
      aria-label={ledgerPageCopy.navigation}
      className="grid h-full w-full grid-cols-[repeat(2,minmax(0,1fr))_4.5rem_repeat(2,minmax(0,1fr))] items-stretch"
    >
      {tab("records")}
      {tab("entries")}
      <button
        type="button"
        disabled={disabled}
        onClick={onOpenInput}
        onPointerEnter={onInputIntent}
        onPointerDown={onInputIntent}
        onFocus={onInputIntent}
        className="m-auto inline-flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-bg active:scale-[0.98] disabled:opacity-60"
        aria-label={ledgerPageCopy.newRecord}
      >
        <Plus className="size-5" aria-hidden="true" />
      </button>
      {tab("stats")}
      {tab("settings")}
    </nav>
  );
}

interface NavButtonProps {
  variant: "bottom" | "top";
  active: boolean;
  refreshing: boolean;
  icon: typeof ReceiptText;
  label: string;
  onClick: () => void;
  onIntent?: (() => void) | undefined;
  disabled: boolean;
}

function NavButton({
  variant,
  active,
  refreshing,
  icon: Icon,
  label,
  onClick,
  onIntent,
  disabled,
}: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? commonCopy.loading : undefined}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
      aria-current={active ? "page" : undefined}
      aria-busy={refreshing || undefined}
      className={cn(
        "relative inline-flex min-w-0 items-center justify-center font-medium transition-colors",
        variant === "bottom"
          ? "h-full flex-col gap-0.5 px-1 text-micro"
          : textRoleClassName(
              "body",
              "gap-1.5 px-3 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-transparent"
            ),
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : active
            ? cn("text-primary", variant === "top" && "after:bg-primary")
            : "text-muted-foreground hover:text-text"
      )}
    >
      {refreshing ? (
        <RefreshCw
          className="size-5 shrink-0 motion-safe:animate-spin md:size-4"
          aria-hidden="true"
        />
      ) : (
        <Icon className="size-5 shrink-0 md:size-4" aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
