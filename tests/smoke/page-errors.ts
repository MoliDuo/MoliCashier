import type { Page } from "@playwright/test";

/** WebKit's message for a route prefetch that a navigation cancelled. */
const CANCELLED_PREFETCH = /\?_rsc=\S+ due to access control checks\.$/;

/**
 * Collects the page's uncaught errors, for a spec to expect none.
 *
 * WebKit rejects a fetch that a navigation cancels as "… due to access control
 * checks", and Next.js leaves that rejection of its route prefetches uncaught.
 * A spec that reloads while the tabs are still prefetching (seedRecord does)
 * would fail on WebKit for requests nobody needed any more; Chromium drops them
 * silently. Only that message is left out.
 */
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (!CANCELLED_PREFETCH.test(error.message)) errors.push(error.message);
  });
  return errors;
}
