import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildLedgerUrl,
  parseStatusesParam,
  formatStatusesParam,
  buildEntriesDrilldownSearchParams,
  readLedgerFilterParams,
  updateLedgerSearchParams,
} from "@/modules/workspace/ledger-url-params";
import { pushLedgerUrl, replaceLedgerUrl } from "@/modules/workspace/ledger-url-navigation";
import { normalizePeriodSearchParams } from "@/modules/workspace/period-url-params";

describe("ledger-url-params", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("treats __uncategorized__ as a real category filter while clearing empty params", () => {
    const params = updateLedgerSearchParams(
      new URLSearchParams("categoryId=old&currency=USD&minAmount=5&maxAmount=10"),
      {
        categoryId: "__uncategorized__",
        currency: "",
        minAmount: null,
        maxAmount: "NaN",
      }
    );

    expect(params.get("categoryId")).toBe("__uncategorized__");
    expect(params.get("currency")).toBeNull();
    expect(params.get("minAmount")).toBeNull();
    expect(params.get("maxAmount")).toBeNull();
  });

  it("reads __uncategorized__ back from the URL", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams("categoryId=__uncategorized__&currency=USD")
    );

    expect(filters.categoryId).toBe("__uncategorized__");
    expect(filters.statuses).toEqual([]);
  });

  it("doesn't drop uncategorized when unrelated params change", () => {
    const params = updateLedgerSearchParams(new URLSearchParams("categoryId=__uncategorized__"), {
      currency: "EUR",
    });

    expect(params.toString()).toContain("categoryId=__uncategorized__");
  });

  it("reads normalized filter params from URLSearchParams", () => {
    const filters = readLedgerFilterParams(
      new URLSearchParams("categoryId=cat_2&currency=EUR&minAmount=100&maxAmount=250")
    );

    expect(filters).toEqual({
      categoryId: "cat_2",
      currency: "EUR",
      minAmount: "100",
      maxAmount: "250",
      statuses: [],
      search: null,
    });
  });

  it("writes and overwrites numeric filter params", () => {
    const params = updateLedgerSearchParams(new URLSearchParams("minAmount=5"), {
      minAmount: "100",
      maxAmount: "250",
    });

    expect(params.get("minAmount")).toBe("100");
    expect(params.get("maxAmount")).toBe("250");
  });

  it("rejects non-finite and blank numeric filter params", () => {
    for (const raw of ["", " ", "Infinity", "-Infinity", "NaN"]) {
      const filters = readLedgerFilterParams(
        new URLSearchParams(`minAmount=${encodeURIComponent(raw)}`)
      );
      expect(filters.minAmount).toBeNull();
    }

    const params = updateLedgerSearchParams(new URLSearchParams("minAmount=1&maxAmount=2"), {
      minAmount: "Infinity",
      maxAmount: "-Infinity",
    });
    expect(params.get("minAmount")).toBeNull();
    expect(params.get("maxAmount")).toBeNull();
  });

  it("builds URLs without introducing navigation side effects", () => {
    const params = new URLSearchParams("period=custom");

    expect(buildLedgerUrl("/ledger/test-id", params)).toBe("/ledger/test-id?period=custom");
  });

  it("replaces the browser URL synchronously", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const params = new URLSearchParams("period=custom");

    const replacedUrl = replaceLedgerUrl("/ledger/test-id", params);

    expect(replacedUrl).toBe("/ledger/test-id?period=custom");
    expect(replaceState).toHaveBeenCalled();
  });

  it("replaces a detail entry when filtering so Back cannot restore the modal", () => {
    window.history.replaceState(
      { cashier: { ledgerNavigation: true, kind: "detail" } },
      "",
      "/ledger/test-id?detail=document-1"
    );
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");

    const url = pushLedgerUrl(
      "/ledger/test-id",
      new URLSearchParams("period=week&detail=document-1"),
      "filter"
    );

    expect(url).toBe("/ledger/test-id?period=week");
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it("builds a drilldown query from nothing but the range and what was pressed", () => {
    expect(
      buildEntriesDrilldownSearchParams({
        startDate: "2026-02-01",
        endDate: "2026-02-28",
        categoryId: "c1",
        currency: null,
      }).toString()
    ).toBe("range=custom&from=2026-02-01&to=2026-02-28&categoryId=c1");
  });

  describe("parseStatusesParam", () => {
    it("normalizes status filters into canonical valid values", () => {
      const cases = [
        [null, []],
        ["", []],
        ["completed", ["completed"]],
        ["failed,processing", ["processing", "failed"]],
        ["processing,processing,processing", ["processing"]],
        ["processing,unknown_status,failed", ["processing", "failed"]],
        ["unknown,bogus", []],
        [" processing , failed ", ["processing", "failed"]],
        [",processing,", ["processing"]],
        ["processing,,failed", ["processing", "failed"]],
      ] as const;

      for (const [input, expected] of cases) {
        expect(parseStatusesParam(input)).toEqual(expected);
      }
    });
  });

  describe("formatStatusesParam", () => {
    it("serializes status filters canonically", () => {
      const cases = [
        [[], null],
        [["completed"], "completed"],
        [["failed", "processing"], "processing,failed"],
        [["processing", "processing", "processing"], "processing"],
      ] as const;

      for (const [input, expected] of cases) {
        expect(formatStatusesParam([...input])).toBe(expected);
      }
    });
  });

  describe("statuses in updateLedgerSearchParams", () => {
    it("sets statuses parameter when provided", () => {
      const params = updateLedgerSearchParams(new URLSearchParams(""), {
        statuses: ["failed", "failed"],
      });

      expect(params.get("statuses")).toBe("failed");
    });

    it("deletes statuses parameter when the filter is cleared", () => {
      for (const statuses of [null, []] as const) {
        const params = updateLedgerSearchParams(new URLSearchParams("statuses=processing,failed"), {
          statuses: statuses == null ? null : [...statuses],
        });
        expect(params.get("statuses")).toBeNull();
      }
    });

    it("preserves existing statuses when not in updates", () => {
      const params = updateLedgerSearchParams(new URLSearchParams("statuses=processing,failed"), {
        search: "tea",
      });

      expect(params.get("statuses")).toBe("processing,failed");
    });

    it("sets statuses together with other params in one update", () => {
      const params = updateLedgerSearchParams(new URLSearchParams("range=all&minAmount=10"), {
        minAmount: null,
        maxAmount: null,
        statuses: ["cancelled", "failed", "failed"],
      });

      expect(params.get("range")).toBe("all");
      expect(params.get("minAmount")).toBeNull();
      expect(params.get("maxAmount")).toBeNull();
      expect(params.get("statuses")).toBe("failed,cancelled");
    });
  });

  describe("statuses in readLedgerFilterParams", () => {
    it("reads statuses from URL", () => {
      const filters = readLedgerFilterParams(new URLSearchParams("statuses=processing,failed"));

      expect(filters.statuses).toEqual(["processing", "failed"]);
    });

    it("returns empty array when statuses param is absent", () => {
      const filters = readLedgerFilterParams(new URLSearchParams("categoryId=cat_1"));

      expect(filters.statuses).toEqual([]);
    });
  });

  describe("book scope", () => {
    it("ignores the legacy ?bookId URL parameter entirely", () => {
      // The scope moved to a device cookie; a link that still carries the old
      // parameter is read as 总账 and the parameter is not even cleaned up.
      expect(readLedgerFilterParams(new URLSearchParams("bookId=nonsense"))).toEqual({
        categoryId: null,
        currency: null,
        minAmount: null,
        maxAmount: null,
        statuses: [],
        search: null,
      });
      expect(
        normalizePeriodSearchParams(new URLSearchParams(`bookId=${"1".repeat(36)}`))
      ).toBeNull();
    });
  });
});
