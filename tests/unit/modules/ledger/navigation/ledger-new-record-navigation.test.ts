import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLedgerDetail } from "@/modules/ledger/navigation/ledger-detail-navigation";
import {
  closeNewRecord,
  openNewRecord,
} from "@/modules/ledger/navigation/ledger-new-record-navigation";

const pushed = { cashier: { ledgerNavigation: true, kind: "new-record" } };

describe("new-record navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/records?range=week");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("opens 记账 as a history entry of its own, so Back closes it", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openNewRecord();

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining(pushed),
      "",
      "/records?range=week&new=1"
    );
  });

  it("does not stack a second entry when it is already open", () => {
    window.history.replaceState(pushed, "", "/records?new=1");
    const pushState = vi.spyOn(window.history, "pushState");

    openNewRecord();

    expect(pushState).not.toHaveBeenCalled();
  });

  it("closes an entry it pushed by going back", () => {
    window.history.replaceState(pushed, "", "/records?range=week&new=1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    closeNewRecord();

    expect(back).toHaveBeenCalledOnce();
  });

  it("closes one reached by a reload or link by replacing its parameter away", () => {
    window.history.replaceState({}, "", "/records?range=week&new=1");
    const back = vi.spyOn(window.history, "back");

    closeNewRecord();

    expect(back).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?range=week");
  });

  it("does nothing when it is not open", () => {
    const back = vi.spyOn(window.history, "back");
    const replaceState = vi.spyOn(window.history, "replaceState");

    closeNewRecord();

    expect(back).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("opens a saved record without carrying the closed dialog's parameter", () => {
    window.history.replaceState(pushed, "", "/records?range=week&new=1");
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerDetail("document-1");

    expect(pushState).toHaveBeenCalledWith(
      expect.anything(),
      "",
      "/records?range=week&detail=document-1"
    );
  });
});
