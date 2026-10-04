import { describe, expect, it } from "vitest";
import {
  buildJudgmentDigest,
  type DigestDocument,
  type DigestInput,
} from "@/modules/forecast/domain/judgment/digest";
import { addCivilDays } from "@/modules/ledger/domain/period";

function lunch(date: string, index: number): DigestDocument {
  return {
    id: `lunch-${date}-${index}`,
    date,
    title: "午饭",
    inputText: "在食堂吃了一碗牛肉面，加了一个蛋",
    entries: [
      {
        itemName: "牛肉面",
        description: "加蛋",
        categoryId: "food",
        currency: "CNY",
        amount: "25",
        converted: "25",
      },
    ],
  };
}

const tuition: DigestDocument = {
  id: "tuition",
  date: "2026-09-08",
  title: "学费",
  inputText: "第一学期学费",
  entries: [
    {
      itemName: "学费",
      description: null,
      categoryId: "edu",
      currency: "MYR",
      amount: "2500",
      converted: "4000",
    },
  ],
};

function input(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    asOf: "2026-10-04",
    mainCurrency: "CNY",
    categories: [
      { id: "food", name: "餐饮", description: "吃饭和买菜" },
      { id: "edu", name: "教育", description: null },
    ],
    documents: [
      ...Array.from({ length: 60 }, (_, day) => lunch(addCivilDays("2026-08-06", day), 0)),
      tuition,
    ],
    reference: {
      lifeChange: { date: "2026-09-01", dailyBefore: 20, dailyAfter: 30 },
      largeFrom: 150,
      bills: [],
      outlook: [{ key: "food", p10: 600, p50: 700, p90: 800 }],
    },
    maxChars: 100_000,
    inputTextChars: 160,
    ...overrides,
  };
}

describe("buildJudgmentDigest", () => {
  it("writes every document with its lines and short references while it fits", () => {
    const digest = buildJudgmentDigest(input());

    expect(digest.levels).toEqual({ detailed: 61, summarized: 0, folded: 0, dropped: 0 });
    expect(digest.earliest).toBe("2026-08-06");
    expect(digest.text).toContain("Today: 2026-10-04. Main currency: CNY.");
    expect(digest.text).toContain("c1 餐饮: 吃饭和买菜");
    expect(digest.text).toContain(
      "## Spent this month so far (2026-10-01 to 2026-10-04)\nc1 100.00"
    );
    expect(digest.text).toContain("spending changed from 2026-09-01");
    expect(digest.text).toContain("whole-month outlook P10/P50/P90: c1 600/700/800");
    expect(digest.text).toContain(
      "d1 2026-08-06 午饭 =25.00\n  input: 在食堂吃了一碗牛肉面，加了一个蛋"
    );
    expect(digest.text).toContain("  - 学费 | c2 | 4000.00 (MYR 2500.00)");
    expect(digest.refs.documents.get("d1")).toBe("lunch-2026-08-06-0");
    expect(digest.refs.categories.get("c2")).toBe("edu");
    expect(digest.refs.categories.get("c0")).toBe("__uncategorized__");
  });

  it("gives way oldest first — input, then lines, then whole days — and keeps a large purchase's lines", () => {
    const full = buildJudgmentDigest(input()).text.length;

    const tight = buildJudgmentDigest(input({ maxChars: full - 400 }));
    expect(tight.text.length).toBeLessThanOrEqual(full - 400);
    // The oldest lost its typed input first; the newest kept it.
    expect(tight.text).not.toContain("d1 2026-08-06 午饭 =25.00\n  input");
    expect(tight.text).toContain("d61 2026-10-04 午饭 =25.00\n  input");

    const folded = buildJudgmentDigest(input({ maxChars: 2000 }));
    expect(folded.levels.folded).toBeGreaterThan(0);
    expect(folded.text.length).toBeLessThanOrEqual(2000);
    expect(folded.text).toMatch(/\n2026-\d\d-\d\d c1 25.00 x1\n/);
    // A folded document has no reference to answer with.
    expect(folded.refs.documents.has("d1")).toBe(false);
    expect(folded.text).toContain("  - 学费 | c2 | 4000.00 (MYR 2500.00)");

    const dropped = buildJudgmentDigest(input({ maxChars: 1200 }));
    expect(dropped.levels.dropped).toBeGreaterThan(0);
    expect(dropped.text).toContain("older documents left out for length");
  });

  it("leaves out what was recorded after the day judged", () => {
    const digest = buildJudgmentDigest(input({ asOf: "2026-09-01" }));

    expect(digest.text).not.toContain("学费");
    expect(digest.levels.detailed).toBe(27);
  });
});
