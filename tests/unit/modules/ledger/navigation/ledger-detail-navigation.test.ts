import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeLedgerDetail,
  openLedgerDetail,
  openLedgerEntrySourceDocument,
  restoreDetailReturnFocus,
} from "@/modules/ledger/navigation/ledger-detail-navigation";

const pushed = { cashier: { ledgerNavigation: true, kind: "detail" } };

describe("ledger detail navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/details?range=week");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("writes the record into the URL as a history entry of its own", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: "document-1" });

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining(pushed),
      "",
      "/details?range=week&detail=document-1"
    );
  });

  it("opens nothing for an entry with no record", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: null });

    expect(pushState).not.toHaveBeenCalled();
  });

  it("replaces an open record instead of stacking a second one", () => {
    window.history.replaceState(pushed, "", "/details?range=week&detail=document-1");
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");

    openLedgerDetail("document-2");

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining(pushed),
      "",
      "/details?range=week&detail=document-2"
    );
  });

  it("keeps a linked record's entry unmarked when it is replaced, so closing stays in the app", () => {
    window.history.replaceState({}, "", "/details?detail=document-1");

    openLedgerDetail("document-2");

    expect(window.history.state).toMatchObject({ cashier: { kind: "filter" } });
  });

  it("closes a record it pushed by going back", () => {
    window.history.replaceState(pushed, "", "/details?range=week&detail=document-1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    closeLedgerDetail();

    expect(back).toHaveBeenCalledOnce();
  });

  it("closes a linked record by replacing its parameter away", () => {
    window.history.replaceState({}, "", "/details?range=week&detail=document-1");
    const back = vi.spyOn(window.history, "back");

    closeLedgerDetail();

    expect(back).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?range=week");
  });

  describe("handing focus back", () => {
    function button(label: string): HTMLButtonElement {
      const element = document.createElement("button");
      element.textContent = label;
      document.body.append(element);
      return element;
    }

    beforeEach(() => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        callback(0);
        return 0;
      });
    });

    afterEach(() => {
      document.body.replaceChildren();
    });

    it("returns focus to the control that opened the record once it has gone", () => {
      const card = button("card");
      card.focus();
      openLedgerDetail("document-1");
      card.blur();

      restoreDetailReturnFocus();

      expect(document.activeElement).toBe(card);
    });

    it("leaves focus where the reader put it while the record was leaving", () => {
      // The sheet finishes leaving a moment after it closes; a reader who
      // tabbed to the gear in that moment keeps it.
      const card = button("card");
      const gear = button("gear");
      card.focus();
      openLedgerDetail("document-1");
      gear.focus();

      restoreDetailReturnFocus();

      expect(document.activeElement).toBe(gear);
    });

    it("still takes focus back from inside the leaving sheet", () => {
      const card = button("card");
      card.focus();
      openLedgerDetail("document-1");
      const sheet = document.createElement("div");
      sheet.setAttribute("role", "dialog");
      document.body.append(sheet);
      const close = document.createElement("button");
      sheet.append(close);
      close.focus();

      restoreDetailReturnFocus();

      expect(document.activeElement).toBe(card);
    });
  });
});
