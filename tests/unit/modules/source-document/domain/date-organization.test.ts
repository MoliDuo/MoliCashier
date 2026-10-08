import { describe, expect, it } from "vitest";
import {
  createDateOrganizationSuggestion,
  resolveDateHint,
} from "@/modules/source-document/domain/date-organization";

describe("date organization", () => {
  it("resolves relative dates from the persisted reference date", () => {
    expect(
      resolveDateHint({ kind: "relative", value: "yesterday", sourceText: "昨天" }, "2026-01-01")
    ).toBe("2025-12-31");
    expect(
      resolveDateHint(
        { kind: "relative", value: "day_before_yesterday", sourceText: "前天" },
        "2026-01-01"
      )
    ).toBe("2025-12-30");
  });

  it("resolves month and day into the reference year, rolling back when needed", () => {
    expect(
      resolveDateHint({ kind: "month_day", value: "12-31", sourceText: "12月31日" }, "2026-01-02")
    ).toBe("2025-12-31");
    expect(
      resolveDateHint({ kind: "month_day", value: "1-2", sourceText: "1月2日" }, "2026-01-03")
    ).toBe("2026-01-02");
  });

  it("omits suggestions when every resolved date is the posting date", () => {
    expect(
      createDateOrganizationSuggestion({
        referenceDate: "2026-01-03",
        sourceDocumentDate: "2026-01-02",
        entries: [
          {
            id: "entry-1",
            itemName: "Coffee",
            amount: "4.00",
            currency: "USD",
            dateHint: { kind: "absolute", value: "2026-01-02", sourceText: "Jan 2" },
          },
        ],
      })
    ).toBeNull();
  });

  it("only resolves complete dates when a historical attempt has no reference date", () => {
    expect(
      resolveDateHint({ kind: "relative", value: "yesterday", sourceText: "昨天" }, null)
    ).toBeNull();
    expect(
      resolveDateHint({ kind: "month_day", value: "12-31", sourceText: "12月31日" }, null)
    ).toBeNull();
    expect(
      resolveDateHint({ kind: "absolute", value: "2025-12-31", sourceText: "2025年12月31日" }, null)
    ).toBe("2025-12-31");
  });
});
