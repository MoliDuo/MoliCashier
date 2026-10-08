"use client";

import { createContext, useContext } from "react";
import type { CategoryAssignmentJobDto } from "@/modules/ledger/contracts";

/**
 * What the page below reads of the ledger's assignment run: only whether one is
 * moving, and how to adopt a run it started. The run itself, its read errors and
 * the band's commands stay with the provider, so the run loading after the page
 * arrives — a finished one, say — leaves this value as it was. A page still
 * streaming in from the server is thrown away and rendered again on the client
 * when a context above it changes before it hydrates.
 */
export interface CategoryAssignmentContextValue {
  isActive: boolean;
  registerSubmittedJob: (job: CategoryAssignmentJobDto) => void;
}

/**
 * The page's view of the ledger's assignment run. It lives in its own module on
 * purpose: the settings section and the details dialog read the run without
 * pulling in the provider — and with it the status band — ahead of the page.
 */
export const CategoryAssignmentContext = createContext<CategoryAssignmentContextValue | null>(null);

/**
 * The run as the page above the tabs sees it. Read it instead of starting a poll
 * of your own: one owner means one poll, one history of what this page watched,
 * and one completion notice, whichever tab happens to be mounted.
 */
export function useCategoryAssignment(): CategoryAssignmentContextValue {
  const value = useContext(CategoryAssignmentContext);
  if (value == null) {
    throw new Error("useCategoryAssignment must be used inside CategoryAssignmentProvider");
  }
  return value;
}
