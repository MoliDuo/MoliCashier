import { describe, expect, it } from "vitest";
import {
  billDayModel,
  billKey,
  detectRecurringBills,
  upcomingDates,
  withRecordedOn,
  type RecurringBill,
} from "@/modules/forecast/domain/recurring";
import type { HistoryRow } from "@/modules/forecast/domain/series";

function bill(
  date: string,
  label: string,
  amount: string,
  options: { categoryId?: string | null; documentId?: string } = {}
): HistoryRow {
  return {
    date,
    categoryId: options.categoryId === undefined ? "housing" : options.categoryId,
    currency: "CNY",
    amount,
    documentId: options.documentId ?? `${date}:${label}`,
    label,
  };
}

const RENT = ["2026-05-05", "2026-06-05", "2026-07-06", "2026-08-05", "2026-09-04"].map((date) =>
  bill(date, `${Number(date.slice(5, 7))}月房租`, "3000")
);

describe("billKey", () => {
  it("takes out the parts of a name that change from one bill to the next", () => {
    expect(billKey("10月房租")).toBe("房租");
    expect(billKey("Netflix #2291")).toBe(billKey("netflix #2304"));
    expect(billKey("2026-10")).toBe("");
  });
});

describe("detectRecurringBills", () => {
  it("finds a monthly bill under names that change, with how long it has kept coming", () => {
    const bills = detectRecurringBills(RENT, "2026-09-20");

    expect(bills).toEqual([
      expect.objectContaining({
        label: "9月房租",
        categoryKey: "housing",
        cadence: "monthly",
        amount: 3000,
        streak: 5,
        lastDate: "2026-09-04",
      }),
    ]);
    expect(bills[0]!.documentIds.size).toBe(5);
  });

  it("files a bill under its largest line and adds up a document's lines", () => {
    const rows = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"].flatMap((date) => [
      bill(date, "Gym", "45", { categoryId: "sport", documentId: date }),
      bill(date, "Gym", "5", { categoryId: "drinks", documentId: date }),
    ]);

    expect(detectRecurringBills(rows, "2026-07-25")).toEqual([
      expect.objectContaining({ categoryKey: "sport", cadence: "weekly", amount: 50, streak: 4 }),
    ]);
  });

  it("passes over irregular gaps, amounts that wander, two in a row, and a bill that stopped", () => {
    const irregular = ["2026-06-01", "2026-06-11", "2026-07-20", "2026-08-01"].map((date) =>
      bill(date, "Taxi", "30")
    );
    const wandering = ["2026-06-01", "2026-07-01", "2026-08-01"].map((date, index) =>
      bill(date, "Groceries", String(100 + index * 80))
    );

    expect(detectRecurringBills(irregular, "2026-08-02")).toEqual([]);
    expect(detectRecurringBills(wandering, "2026-08-02")).toEqual([]);
    expect(detectRecurringBills(RENT.slice(-2), "2026-09-20")).toEqual([]);
    // Nothing since the 4th of September, and it is November.
    expect(detectRecurringBills(RENT, "2026-11-01")).toEqual([]);
  });

  it("leaves out refunds, unnamed documents and days still to come", () => {
    const rows = [
      ...RENT.map((row) => ({ ...row, amount: "-3000" })),
      ...RENT.map((row) => ({ ...row, label: null })),
      ...RENT.map((row) => ({ ...row, date: row.date.replace("2026", "2027") })),
    ];
    expect(detectRecurringBills(rows, "2026-09-20")).toEqual([]);
  });
});

describe("upcomingDates", () => {
  const monthly: RecurringBill = {
    label: "房租",
    categoryKey: "housing",
    cadence: "monthly",
    amount: 3000,
    streak: 5,
    lastDate: "2026-08-31",
    documentIds: new Set(),
  };

  it("keeps a monthly bill's day, falling on a short month's last day", () => {
    expect(upcomingDates(monthly, "2026-09-01", "2026-10-31")).toEqual([
      "2026-09-30",
      "2026-10-31",
    ]);
    expect(
      upcomingDates(
        { ...monthly, cadence: "weekly", lastDate: "2026-09-01" },
        "2026-09-01",
        "2026-09-20"
      )
    ).toEqual(["2026-09-08", "2026-09-15"]);
  });

  it("expects a bill that is due and not yet recorded tomorrow", () => {
    expect(
      upcomingDates({ ...monthly, lastDate: "2026-08-05" }, "2026-09-07", "2026-09-30")
    ).toEqual(["2026-09-08"]);
  });

  it("plays a bill for certain on its days only", () => {
    const model = billDayModel({ ...monthly, lastDate: "2026-08-15" }, "2026-09-10", "2026-09-30");
    expect(model.chance(5)).toBe(1);
    expect(model.chance(4)).toBe(0);
    expect(model.amount(5, 0.3)).toBe(3000);
  });
});

describe("withRecordedOn", () => {
  const rent = detectRecurringBills(RENT, "2026-10-04");

  it("moves a bill on to a day it was recorded, so it is not expected again the day after", () => {
    const today = "2026-10-05";
    const [moved] = withRecordedOn(rent, [...RENT, bill(today, "10月房租", "3000")], today);

    expect(moved).toMatchObject({ lastDate: today, amount: 3000, streak: 5 });
    expect(upcomingDates(moved!, today, "2026-10-31")).toEqual([]);
    // Without today's, the rent that is due is expected tomorrow.
    expect(upcomingDates(rent[0]!, today, "2026-10-31")).toEqual(["2026-10-06"]);
  });

  it("leaves a bill alone for a document of another name, another category or a refund", () => {
    const today = "2026-10-05";
    const others = [
      bill(today, "水电费", "200"),
      bill(today, "10月房租", "3000", { categoryId: "fun", documentId: "elsewhere" }),
      bill(today, "10月房租", "-3000", { documentId: "refund" }),
    ];

    expect(withRecordedOn(rent, [...RENT, ...others], today)).toEqual(rent);
  });
});
