import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CategoryAssignmentEntryStateContext,
  createCategoryAssignmentEntryStateStore,
  useCategoryAssignmentEntryState,
} from "@/modules/ledger/ui/category-assignment-entry-states";

describe("createCategoryAssignmentEntryStateStore", () => {
  it("answers per entry and lets a pending mark outrank a failed one", () => {
    const store = createCategoryAssignmentEntryStateStore();

    store.replace({ pendingIds: ["a", "c"], failedIds: ["b", "c"] });

    expect(store.get("a")).toBe("pending");
    expect(store.get("b")).toBe("failed");
    expect(store.get("c")).toBe("pending");
    expect(store.get("d")).toBeNull();
  });

  it("replaces everything at once, and null clears it", () => {
    const store = createCategoryAssignmentEntryStateStore();
    store.replace({ pendingIds: ["a"], failedIds: [] });

    store.replace({ pendingIds: [], failedIds: ["b"] });
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBe("failed");

    store.replace(null);
    expect(store.get("b")).toBeNull();
  });

  it("tells its listeners only when something changed", () => {
    const store = createCategoryAssignmentEntryStateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.replace({ pendingIds: ["a"], failedIds: [] });
    store.replace({ pendingIds: ["a"], failedIds: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    store.replace({ pendingIds: [], failedIds: ["a"] });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.replace(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("useCategoryAssignmentEntryState", () => {
  const renders: Record<string, number> = { a: 0, b: 0 };
  function Row({ id }: { id: string }) {
    useEffect(() => {
      renders[id] = (renders[id] ?? 0) + 1;
    });
    return <p data-testid={`row-${id}`}>{useCategoryAssignmentEntryState(id) ?? "none"}</p>;
  }

  it("has no state outside the provider", () => {
    render(<Row id="a" />);

    expect(screen.getByTestId("row-a").textContent).toBe("none");
  });

  it("re-renders only the rows whose own entry changed", () => {
    const store = createCategoryAssignmentEntryStateStore();
    render(
      <CategoryAssignmentEntryStateContext.Provider value={store}>
        <Row id="a" />
        <Row id="b" />
      </CategoryAssignmentEntryStateContext.Provider>
    );
    const before = { ...renders };

    act(() => store.replace({ pendingIds: ["a"], failedIds: [] }));

    expect(screen.getByTestId("row-a").textContent).toBe("pending");
    expect(renders.a).toBe(before.a! + 1);
    expect(renders.b).toBe(before.b);
  });
});
