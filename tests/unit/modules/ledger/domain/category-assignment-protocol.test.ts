import { describe, expect, it } from "vitest";
import type { AiContentPart } from "@/lib/ai/client";
import {
  buildCategoryAssignmentDocumentMessage,
  buildCategoryAssignmentPrompt,
  resolveCategoryAssignmentDecisions,
  type CategoryAssignmentCandidate,
  type CategoryAssignmentDocumentGroup,
  type CategoryAssignmentSubject,
} from "@/modules/ledger/domain/category-assignment-protocol";

const candidates: CategoryAssignmentCandidate[] = [
  { id: "cat-food", name: "吃喝", description: "正餐与饮品" },
  { id: "cat-home", name: "居家", description: null },
  { id: "cat-health", name: "健康", description: "医疗与健身" },
];

function subject(overrides: Partial<CategoryAssignmentSubject> = {}): CategoryAssignmentSubject {
  return {
    ledgerEntryId: "entry-1",
    itemName: "Lunch set",
    description: null,
    amount: "45.00",
    currency: "CNY",
    currentCategoryId: null,
    currentCategoryName: null,
    ...overrides,
  };
}

function group(
  overrides: Partial<CategoryAssignmentDocumentGroup> = {}
): CategoryAssignmentDocumentGroup {
  return {
    sourceDocumentId: "doc-1",
    title: null,
    documentDate: "2026-09-10",
    inputText: null,
    storedFileIds: [],
    subjects: [
      subject({ ledgerEntryId: "a", itemName: "Lunch", amount: "45.00", currency: "CNY" }),
      subject({
        ledgerEntryId: "b",
        itemName: "Taxi",
        amount: "18.00",
        currency: null,
        currentCategoryName: "出行",
      }),
    ],
    ...overrides,
  };
}

function textOf(parts: readonly AiContentPart[]): string {
  const [first] = parts;
  return first != null && first.type === "text" ? first.text : "";
}

describe("buildCategoryAssignmentPrompt", () => {
  it("numbers candidates from 1 and requires the closest candidate", () => {
    const prompt = buildCategoryAssignmentPrompt({ candidates });

    expect(prompt).toContain("1. 吃喝 — 正餐与饮品");
    expect(prompt).toContain("2. 居家");
    expect(prompt).toContain("3. 健康 — 医疗与健身");
    expect(prompt).toContain("Every entry must be assigned to exactly one candidate category");
    expect(prompt).toContain("choose the closest candidate");
    expect(prompt).not.toContain("category_index 0");
  });

  it("scopes the entry list to one document and treats the current category as a weak hint", () => {
    const prompt = buildCategoryAssignmentPrompt({ candidates });

    expect(prompt).toContain("That list covers a single source document");
    expect(prompt).toContain("weak hint, not a verdict");
    expect(prompt).toContain("Never copy it back");
  });

  it("has the model judge each entry in the document's context, not by its name alone", () => {
    const prompt = buildCategoryAssignmentPrompt({ candidates });

    expect(prompt).toContain("not by the words of an item name taken alone");
    expect(prompt).toContain("Read the document first");
    expect(prompt).toContain("title, submitted text, date, any attached image");
    expect(prompt).toContain("Bill-level lines follow the items they belong to");
  });

  it("asks for the document's context and a reason before each category index", () => {
    const prompt = buildCategoryAssignmentPrompt({ candidates });

    expect(prompt).toContain('"document_context"');
    expect(prompt.indexOf('"reason"')).toBeLessThan(prompt.indexOf('"category_index": 2'));
  });

  it("carries the ledger's own instructions when it has any", () => {
    expect(buildCategoryAssignmentPrompt({ candidates, customPrompt: "只按商家判断" })).toContain(
      "只按商家判断"
    );
    expect(buildCategoryAssignmentPrompt({ candidates, customPrompt: "" })).not.toContain(
      "Additional Instructions"
    );
    expect(buildCategoryAssignmentPrompt({ candidates })).not.toContain("Additional Instructions");
  });

  it("opens as an expense categorizer, which is how the demo AI server recognizes the request", () => {
    expect(buildCategoryAssignmentPrompt({ candidates })).toContain(
      "You are an expense categorizer"
    );
  });

  it("says nothing about an output locale", () => {
    // The response is integers; an output-locale directive would be noise.
    const prompt = buildCategoryAssignmentPrompt({ candidates });

    expect(prompt).not.toContain("Mandatory Output Locale");
    expect(prompt).not.toContain("Output Locale");
  });
});

describe("buildCategoryAssignmentDocumentMessage", () => {
  it("numbers the document's entries from 1 and shows where each one sits today", () => {
    const parts = buildCategoryAssignmentDocumentMessage({ group: group() });

    expect(parts).toHaveLength(1);
    const body = textOf(parts);
    expect(body).toContain("### Source Document");
    expect(body).toContain("### Expense Entries");
    expect(body).toContain(
      "1. item_name: Lunch | amount: 45.00 CNY | current_category: uncategorized"
    );
    expect(body).toContain("2. item_name: Taxi | amount: 18.00 | current_category: 出行");
  });

  it("carries the document's own context when it has any", () => {
    const body = textOf(
      buildCategoryAssignmentDocumentMessage({
        group: group({
          title: "全家便利店",
          documentDate: "2026-09-10",
          inputText: "楼下买的",
        }),
      })
    );

    expect(body).toContain("document_title: 全家便利店");
    expect(body).toContain("document_date: 2026-09-10");
    expect(body).toContain("submitted_text: 楼下买的");
  });

  it("omits context the document does not have and says nothing about images", () => {
    const body = textOf(
      buildCategoryAssignmentDocumentMessage({
        group: group({ title: "", inputText: "" }),
      })
    );

    expect(body).not.toContain("document_title:");
    expect(body).not.toContain("submitted_text:");
    expect(body).not.toContain("attached_images:");
  });

  it("appends the evidence as image parts after the text, in the order given", () => {
    const parts = buildCategoryAssignmentDocumentMessage({
      group: group({ storedFileIds: ["f1", "f2"] }),
      images: [{ dataUrl: "data:image/jpeg;base64,AAA" }, { dataUrl: "data:image/png;base64,BBB" }],
    });

    expect(parts).toEqual([
      { type: "text", text: expect.stringContaining("attached_images: 2") },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
      { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
    ]);
  });
});

describe("resolveCategoryAssignmentDecisions", () => {
  const subjects = [
    subject({ ledgerEntryId: "a", currentCategoryId: null }),
    subject({ ledgerEntryId: "b", currentCategoryId: "cat-home" }),
    subject({ ledgerEntryId: "c", currentCategoryId: "cat-food" }),
  ];

  it("resolves one complete decision for every entry", () => {
    expect(
      resolveCategoryAssignmentDecisions({
        subjects,
        candidates,
        response: {
          decisions: [
            { entry_index: 1, category_index: 1 },
            { entry_index: 2, category_index: 3 },
            { entry_index: 3, category_index: 2 },
          ],
        },
      })
    ).toEqual({
      decisions: [
        { ledgerEntryId: "a", categoryId: "cat-food" },
        { ledgerEntryId: "b", categoryId: "cat-health" },
        { ledgerEntryId: "c", categoryId: "cat-home" },
      ],
      confirmedCount: 0,
    });
  });

  it("returns targets that already match so the transaction can confirm them", () => {
    expect(
      resolveCategoryAssignmentDecisions({
        subjects,
        candidates,
        response: {
          decisions: [
            { entry_index: 1, category_index: 1 },
            { entry_index: 2, category_index: 2 },
            { entry_index: 3, category_index: 1 },
          ],
        },
      })
    ).toEqual({
      decisions: [
        { ledgerEntryId: "a", categoryId: "cat-food" },
        { ledgerEntryId: "b", categoryId: "cat-home" },
        { ledgerEntryId: "c", categoryId: "cat-food" },
      ],
      confirmedCount: 0,
    });
  });

  it("rejects zero and out-of-range indexes", () => {
    const cases: readonly {
      label: string;
      decisions: { entry_index: number; category_index: number }[];
    }[] = [
      { label: "an explicit 0", decisions: [{ entry_index: 1, category_index: 0 }] },
      { label: "a category past the list", decisions: [{ entry_index: 1, category_index: 9 }] },
      { label: "an entry past the slice", decisions: [{ entry_index: 9, category_index: 1 }] },
    ];
    for (const testCase of cases) {
      expect(() =>
        resolveCategoryAssignmentDecisions({
          subjects: [subjects[0]!],
          candidates,
          response: { decisions: testCase.decisions },
        })
      ).toThrowError(expect.objectContaining({ code: "ai_schema_invalid" }));
    }
  });

  it("rejects duplicate entry decisions", () => {
    expect(() =>
      resolveCategoryAssignmentDecisions({
        subjects: subjects.slice(0, 2),
        candidates,
        response: {
          decisions: [
            { entry_index: 1, category_index: 2 },
            { entry_index: 1, category_index: 3 },
          ],
        },
      })
    ).toThrowError(expect.objectContaining({ code: "ai_schema_invalid" }));
  });

  it("rejects missing entry decisions", () => {
    expect(() =>
      resolveCategoryAssignmentDecisions({
        subjects,
        candidates,
        response: { decisions: [{ entry_index: 3, category_index: 3 }] },
      })
    ).toThrowError(expect.objectContaining({ code: "ai_schema_invalid" }));
  });
});
