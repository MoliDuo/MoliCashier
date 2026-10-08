import { describe, expect, it } from "vitest";
import {
  LEDGER_ROUTES,
  isLedgerTab,
  ledgerTabFromPathname,
  ledgerTabHref,
} from "@/modules/workspace/ledger-tabs";

describe("ledger tabs helpers", () => {
  it("lists the four tabs in navigation order", () => {
    expect(LEDGER_ROUTES).toEqual(["records", "entries", "stats", "settings"]);
  });

  it("reads the route from its pathname", () => {
    expect(ledgerTabFromPathname("/stats")).toBe("stats");
    expect(ledgerTabFromPathname("/entries")).toBe("entries");
    expect(ledgerTabFromPathname("/records/")).toBe("records");
  });

  it("falls back to 账目 for anything that is not a ledger route", () => {
    expect(ledgerTabFromPathname("/")).toBe("records");
    expect(ledgerTabFromPathname("/stream")).toBe("records");
    expect(ledgerTabFromPathname(null)).toBe("records");
  });

  it("builds a route href with its query", () => {
    expect(ledgerTabHref("settings")).toBe("/settings");
    expect(ledgerTabHref("entries", "search=tea")).toBe("/entries?search=tea");
  });

  it("validates ledger route values", () => {
    expect(isLedgerTab("settings")).toBe(true);
    expect(isLedgerTab("entries")).toBe(true);
    expect(isLedgerTab("stream")).toBe(false);
    expect(isLedgerTab(null)).toBe(false);
  });
});
