import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { closeLedgerDetail } from "@/modules/ledger/navigation/ledger-detail-navigation";
import { writeLedgerHistory } from "@/modules/ledger/navigation/ledger-history";

function TestDialog({ initiallyOpen = true, closeOnBack = true, locked = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>
        done
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => !locked && setOpen(next)}
        closeOnBack={closeOnBack}
      >
        <DialogContent variant="modal" aria-describedby={undefined}>
          <DialogTitle>Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

function overlayDepth(): number | undefined {
  return (window.history.state as { cashierOverlay?: { depth: number } } | null)?.cashierOverlay
    ?.depth;
}

/** What Back does: the entry under the top one becomes current, then popstate. */
function goBack(state: unknown) {
  act(() => {
    window.history.replaceState(state, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  });
}

describe("dialogs as history entries", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/records");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("pushes an entry for the same page while open", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    render(<TestDialog />);

    expect(pushState).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe("/records");
    expect(overlayDepth()).toBe(1);
  });

  it("closes when Back pops its entry, and leaves the page where it was", () => {
    render(<TestDialog />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    goBack({});

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/records");
  });

  it("pops its own entry when it is closed some other way", () => {
    vi.useFakeTimers();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<TestDialog />);

    act(() => screen.getByRole("button", { name: "done", hidden: true }).click());
    act(() => vi.runAllTimers());

    expect(back).toHaveBeenCalledOnce();
  });

  it("stays open without an entry when it refuses to close", () => {
    render(<TestDialog locked />);

    goBack({});

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("writes no entry when its open state lives in the URL", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    render(<TestDialog closeOnBack={false} />);

    expect(pushState).not.toHaveBeenCalled();
  });

  it("lets a navigation from an open dialog take its entry over instead of stacking", () => {
    render(<TestDialog />);
    const pushState = vi.spyOn(window.history, "pushState");

    writeLedgerHistory("push", "/records?range=week", "filter");

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?range=week");
    expect(overlayDepth()).toBeUndefined();
  });

  it("takes the dialogs stacked on a closing sheet along in one jump", () => {
    vi.useFakeTimers();
    window.history.replaceState(
      { cashier: { ledgerNavigation: true, kind: "detail" } },
      "",
      "/records?detail=document-1"
    );
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<TestDialog />);

    closeLedgerDetail();
    act(() => screen.getByRole("button", { name: "done", hidden: true }).click());
    act(() => vi.runAllTimers());

    expect(go).toHaveBeenCalledWith(-2);
    expect(back).not.toHaveBeenCalled();
    // The jump lands, which ends it.
    act(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })));
  });
});
