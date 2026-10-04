"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/** What a list row says about an entry the assignment run is working on. */
export type CategoryAssignmentEntryState = "pending" | "failed";

/**
 * The run's per-entry state, held outside React so a row subscribes to its own
 * entry alone: a poll that moves a handful of entries re-renders those rows, not
 * the thousands of others around them.
 */
export interface CategoryAssignmentEntryStateStore {
  subscribe: (listener: () => void) => () => void;
  get: (entryId: string) => CategoryAssignmentEntryState | null;
  /** Replaces every entry's state; null clears them all. */
  replace: (states: { pendingIds: readonly string[]; failedIds: readonly string[] } | null) => void;
}

export function createCategoryAssignmentEntryStateStore(): CategoryAssignmentEntryStateStore {
  let states = new Map<string, CategoryAssignmentEntryState>();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (entryId) => states.get(entryId) ?? null,
    replace(next) {
      const nextStates = new Map<string, CategoryAssignmentEntryState>();
      for (const id of next?.failedIds ?? []) nextStates.set(id, "failed");
      for (const id of next?.pendingIds ?? []) nextStates.set(id, "pending");
      const unchanged =
        nextStates.size === states.size &&
        [...nextStates].every(([id, state]) => states.get(id) === state);
      if (unchanged) return;
      states = nextStates;
      for (const listener of [...listeners]) listener();
    },
  };
}

const EMPTY_STORE: CategoryAssignmentEntryStateStore = {
  subscribe: () => () => undefined,
  get: () => null,
  replace: () => undefined,
};

/**
 * Its own context, apart from the one the page reads the run through: the store
 * is created once and never changes, so providing it can never re-render the page
 * the way a changing run would. Outside the provider every entry has no state.
 */
export const CategoryAssignmentEntryStateContext =
  createContext<CategoryAssignmentEntryStateStore>(EMPTY_STORE);

/** The state of one entry in the ledger's assignment run, or null when it has none. */
export function useCategoryAssignmentEntryState(
  entryId: string
): CategoryAssignmentEntryState | null {
  const store = useContext(CategoryAssignmentEntryStateContext);
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(entryId),
    () => null
  );
}
