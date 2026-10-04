"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCategoryAssignmentJob } from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { CategoryAssignmentTasks } from "./CategoryAssignmentTasks";
import { CategoryAssignmentContext } from "./category-assignment-context";
import {
  CategoryAssignmentEntryStateContext,
  createCategoryAssignmentEntryStateStore,
} from "./category-assignment-entry-states";

/**
 * Follows the ledger's assignment run above the tabs, so a run survives tab
 * changes, and hands what it learns to the two places that show it: the lists,
 * which mark the entries the run is working on, and the toasts that carry its
 * progress, controls and outcome.
 */
export function CategoryAssignmentProvider({ children }: { children: ReactNode }) {
  const assignment = useCategoryAssignmentJob();
  const { notices, consumeNotice, entryStates } = assignment;
  // Made once and never replaced: it is the one thing every row below reads, so
  // it cannot be a value that changes with the run.
  const [entryStateStore] = useState(createCategoryAssignmentEntryStateStore);
  useEffect(() => {
    entryStateStore.replace(entryStates);
  }, [entryStateStore, entryStates]);
  // The controls and the completion notice are the only readers of the details
  // messages, and they have nothing to do until there is a run, a failed read or
  // an outcome still waiting to be reported.
  const hasSomethingToSay = assignment.job != null || assignment.isReadError || notices.length > 0;
  // The workspace re-renders this on every change of its own, and the run loads
  // after the page arrives; a new value either time would reach every reader
  // below, and a page still streaming in from the server is thrown away and
  // rendered again on the client when its context changes before it hydrates.
  // So the value holds only what the readers use.
  const { isActive, registerSubmittedJob } = assignment;
  const value = useMemo(
    () => ({ isActive, registerSubmittedJob }),
    [isActive, registerSubmittedJob]
  );

  return (
    <CategoryAssignmentContext.Provider value={value}>
      <CategoryAssignmentEntryStateContext.Provider value={entryStateStore}>
        {hasSomethingToSay ? (
          <CategoryAssignmentTasks
            job={assignment.job}
            isReadError={assignment.isReadError}
            onRefresh={assignment.refresh}
            onTaskRegistered={registerSubmittedJob}
            notices={notices}
            onNoticeConsumed={consumeNotice}
          />
        ) : null}
        {children}
      </CategoryAssignmentEntryStateContext.Provider>
    </CategoryAssignmentContext.Provider>
  );
}
