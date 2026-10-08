import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuplicateSuggestionDto } from "@/modules/source-document/contracts";
import { SourceDocumentDuplicateSuggestion } from "@/modules/source-document/ui/SourceDocumentDuplicateSuggestion";

const { openLedgerDetail } = vi.hoisted(() => ({ openLedgerDetail: vi.fn() }));
vi.mock("@/modules/ledger/navigation/ledger-detail-navigation", () => ({ openLedgerDetail }));

const suggestion: DuplicateSuggestionDto = {
  id: "11111111-1111-4111-8111-111111111111",
  coversWholeDocument: false,
  items: [
    {
      ledgerEntryId: "33333333-3333-4333-8333-333333333333",
      itemName: "数据线",
      amount: "19.90",
      currency: "CNY",
      matched: {
        sourceDocumentId: "22222222-2222-4222-8222-222222222222",
        title: "淘宝订单",
        documentDate: "2026-09-10",
        itemName: "数据线",
      },
    },
  ],
};

function renderSuggestion(
  overrides: Partial<React.ComponentProps<typeof SourceDocumentDuplicateSuggestion>> = {}
) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  render(
    <SourceDocumentDuplicateSuggestion
      suggestion={suggestion}
      disabled={false}
      onApply={onApply}
      onDismiss={onDismiss}
      {...overrides}
    />
  );
  return { onApply, onDismiss };
}

describe("SourceDocumentDuplicateSuggestion", () => {
  beforeEach(() => openLedgerDetail.mockClear());

  it("lists each flagged entry on one line, without a sentence around it", () => {
    renderSuggestion();

    expect(screen.getByText(/数据线/)).toBeInTheDocument();
    expect(screen.getByText(/19\.90/)).toBeInTheDocument();
    expect(screen.queryByText(/是同一笔/)).not.toBeInTheDocument();
  });

  it("removes the repeats only when asked, and keeps them on 保留", async () => {
    const { onApply, onDismiss } = renderSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "移除重复" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(suggestion.id));
    fireEvent.click(screen.getByRole("button", { name: "保留" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith(suggestion.id));
  });

  it("offers deleting the record when every entry is a repeat", () => {
    renderSuggestion({ suggestion: { ...suggestion, coversWholeDocument: true } });

    expect(screen.getByRole("button", { name: "删除这张账单" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除重复" })).not.toBeInTheDocument();
  });

  it("opens the record that holds the original", () => {
    renderSuggestion();

    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    expect(openLedgerDetail).toHaveBeenCalledWith(suggestion.items[0]!.matched.sourceDocumentId);
  });

  it("says so, and changes nothing, when the write fails", async () => {
    renderSuggestion({ onApply: vi.fn().mockRejectedValue(new Error("conflict")) });

    fireEvent.click(screen.getByRole("button", { name: "移除重复" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("操作失败，账单未更改。请重试。");
  });

  it("disables both actions while another write runs", () => {
    renderSuggestion({ disabled: true });

    expect(screen.getByRole("button", { name: "移除重复" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保留" })).toBeDisabled();
  });
});
