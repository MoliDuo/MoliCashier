"use client";
import type { ReactNode } from "react";

interface AppShellProps {
  /** The bar along the top: the desktop tabs, 记账 and the book switcher. */
  topBar: ReactNode;
  /**
   * The phone's bar along the bottom; wider screens keep everything on top.
   * Null while the page has an action bar of its own there.
   */
  bottomBar: ReactNode | null;
  children: ReactNode;
}

/**
 * The frame every ledger route shares. It owns the page's side margins, so
 * nothing inside it adds its own inset against the viewport edge.
 */
export function AppShell({ topBar, bottomBar, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh max-w-full flex-col overflow-x-clip bg-bg text-text">
      <header className="sticky top-0 z-header border-b border-border bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-2 sm:px-4 md:px-6">
          {topBar}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        data-ledger-focus-fallback
        className="relative z-content mx-auto flex min-h-0 w-full min-w-0 max-w-6xl flex-1 flex-col overflow-x-clip px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-4 md:px-6 md:pb-6"
      >
        {children}
      </main>
      {bottomBar != null ? (
        <div className="fixed inset-x-0 bottom-0 z-header h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          {bottomBar}
        </div>
      ) : null}
    </div>
  );
}
