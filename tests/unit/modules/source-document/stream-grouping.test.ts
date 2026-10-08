import { describe, expect, it } from "vitest";
import { buildUnifiedStreamGroups } from "@/modules/source-document/stream-grouping";
import type { SourceDocumentListItemDto } from "@/modules/source-document/contracts";
import type { LedgerEntryEmbeddedViewDto } from "@/modules/ledger/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  overrides: Partial<SourceDocumentListItemDto> = {}
): SourceDocumentListItemDto {
  return {
    id,
    version: 1,
    latestAttemptId: null,
    title: `Doc ${id}`,
    text: null,
    processingStatus: "completed",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-07-01",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    hasImages: false,
    pendingSuggestions: [],
    supportedActions: [],
    canEdit: false,
    errorCode: null,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<LedgerEntryEmbeddedViewDto> = {}
): LedgerEntryEmbeddedViewDto {
  return {
    id: "entry-1",
    categoryId: null,
    sourceDocumentId: "document-1",
    amount: "10.00",
    currency: "CNY",
    itemName: "Test",
    description: null,
    convertedAmount: "10.00",
    exchangeRate: "1.0",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildUnifiedStreamGroups
// ---------------------------------------------------------------------------

describe("buildUnifiedStreamGroups", () => {
  it("groups consecutive items by document date preserving server order", () => {
    const c1 = makeItem("c1", {
      processingStatus: "completed",
      documentDate: "2026-07-15",
      ledgerEntries: [makeEntry({ amount: "5.00", convertedAmount: "5.00" })],
    });
    const c2 = makeItem("c2", {
      processingStatus: "completed",
      documentDate: "2026-07-10",
      ledgerEntries: [makeEntry({ amount: "3.00", convertedAmount: "3.00" })],
    });
    const c3 = makeItem("c3", {
      processingStatus: "completed",
      documentDate: "2026-07-20",
      ledgerEntries: [makeEntry({ amount: "7.00", convertedAmount: "7.00" })],
    });

    // Items are already in server order (entryDate DESC, createdAt DESC, id DESC)
    const groups = buildUnifiedStreamGroups([c1, c2, c3]);
    // Groups should preserve server order: Jul 15 -> Jul 10 -> Jul 20
    expect(groups.map((g) => g.date)).toEqual(["2026-07-15", "2026-07-10", "2026-07-20"]);
  });

  it("computes group totals only from completed active entries", () => {
    const completed = makeItem("c1", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      ledgerEntries: [
        makeEntry({ amount: "10.00", convertedAmount: "10.00" }),
        makeEntry({ amount: "5.00", convertedAmount: "5.00" }),
      ],
    });

    const groups = buildUnifiedStreamGroups([completed]);
    expect(groups[0]!.total).toBe("15");
  });

  it("excludes non-completed items from group totals", () => {
    const pending = makeItem("p1", {
      processingStatus: "processing",
      documentDate: "2026-07-01",
    });
    const completed = makeItem("c1", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      ledgerEntries: [makeEntry({ amount: "10.00", convertedAmount: "10.00" })],
    });

    const groups = buildUnifiedStreamGroups([pending, completed]);
    expect(groups).toHaveLength(1);
    // total should come from completed only
    expect(groups[0]!.total).toBe("10");
  });

  it("does not invent a total for empty/pending groups", () => {
    const att = makeItem("q1", {
      processingStatus: "processing",
      documentDate: "2026-07-01",
    });

    const groups = buildUnifiedStreamGroups([att]);
    expect(groups[0]!.total).toBe("0");
  });

  it("preserves server order within same date group without re-sorting", () => {
    const a1 = makeItem("a1", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T10:00:00.000Z",
      ledgerEntries: [makeEntry()],
    });
    const a2 = makeItem("a2", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T09:00:00.000Z",
      ledgerEntries: [makeEntry()],
    });

    // Items arrive in server order (createdAt desc): a1 before a2
    const groups = buildUnifiedStreamGroups([a1, a2]);
    const ids = groups[0]!.items.map((i) => i.sourceDocument.id);
    // Server order preserved: a1 (10:00) before a2 (09:00)
    expect(ids).toEqual(["a1", "a2"]);
  });

  it("preserves server order with mixed statuses without re-sorting", () => {
    const candidate = makeItem("cand", {
      processingStatus: "cancelled",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T12:00:00.000Z",
    });
    const invalid = makeItem("anom", {
      processingStatus: "failed",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T11:00:00.000Z",
    });
    const failed = makeItem("fail", {
      processingStatus: "failed",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T10:00:00.000Z",
    });
    const completed = makeItem("comp", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      createdAt: "2026-07-01T09:00:00.000Z",
      ledgerEntries: [makeEntry()],
    });

    // Server order: createdAt descending
    const groups = buildUnifiedStreamGroups([candidate, invalid, failed, completed]);
    const statuses = groups[0]!.items.map((i) => i.sourceDocument.processingStatus);
    // Server order preserved
    expect(statuses).toEqual(["cancelled", "failed", "failed", "completed"]);
  });

  it("groups items with same document date together", () => {
    const a1 = makeItem("a1", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      ledgerEntries: [makeEntry()],
    });
    const a2 = makeItem("a2", {
      processingStatus: "completed",
      documentDate: "2026-07-01",
      ledgerEntries: [makeEntry()],
    });
    const b1 = makeItem("b1", {
      processingStatus: "completed",
      documentDate: "2026-06-30",
      ledgerEntries: [makeEntry()],
    });

    // Server order: Jul 1 items first, then Jun 30
    const groups = buildUnifiedStreamGroups([a1, a2, b1]);
    // Two groups: Jul 1 (a1, a2) and Jun 30 (b1)
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toHaveLength(1);
  });

  it("returns empty array when passed empty items", () => {
    const groups = buildUnifiedStreamGroups([]);
    expect(groups).toEqual([]);
  });
});
