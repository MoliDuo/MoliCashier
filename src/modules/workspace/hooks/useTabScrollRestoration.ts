"use client";

import { useLayoutEffect, useRef } from "react";
import type { LedgerTab } from "@/modules/workspace/ledger-tabs";

const TAB_SCROLL_RESTORE_TOLERANCE = 1;

export function useTabScrollRestoration(activeTab: LedgerTab): void {
  const positionsRef = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const positions = positionsRef.current;
    const key = activeTab;
    const target = positions.get(key) ?? 0;
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    let frame: number | null = null;
    let observer: ResizeObserver | null = null;
    let clampTimer: number | null = null;
    let restored = false;

    root.style.scrollBehavior = "auto";

    const finish = () => {
      if (restored) return;
      restored = true;
      if (clampTimer != null) window.clearTimeout(clampTimer);
      clampTimer = null;
      observer?.disconnect();
      observer = null;
      frame = window.requestAnimationFrame(() => {
        root.style.scrollBehavior = previousScrollBehavior;
        frame = null;
      });
    };

    const tryRestore = () => {
      if (restored) return;
      const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
      window.scrollTo({ top: target, left: 0, behavior: "auto" });
      if (maximum + TAB_SCROLL_RESTORE_TOLERANCE >= target) finish();
    };

    tryRestore();
    if (!restored && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(tryRestore);
      observer.observe(document.body);
    }
    if (!restored)
      clampTimer = window.setTimeout(() => {
        if (restored) return;
        const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
        window.scrollTo({ top: Math.min(target, maximum), left: 0, behavior: "auto" });
        finish();
      }, 2_000);

    return () => {
      positions.set(key, restored ? window.scrollY : Math.max(window.scrollY, target));
      observer?.disconnect();
      if (clampTimer != null) window.clearTimeout(clampTimer);
      if (frame != null) window.cancelAnimationFrame(frame);
      root.style.scrollBehavior = previousScrollBehavior;
    };
  }, [activeTab]);
}
