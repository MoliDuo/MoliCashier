import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { batchActionsCopy } from "@/copy/workspace";
import { LedgerEntryCard } from "@/modules/ledger/ui/LedgerEntryCard";
import { LedgerEntryItem } from "@/modules/source-document/ui/LedgerEntryItem";
import {
  CategoryAssignmentEntryStateContext,
  createCategoryAssignmentEntryStateStore,
} from "@/modules/ledger/ui/category-assignment-entry-states";

vi.mock("@/modules/currency/ui/AmountDisplay", () => ({
  AmountDisplay: () => <span>CNY 12.00</span>,
}));

const ledgerEntry: LedgerEntryDto = {
  id: "entry-1",
  categoryId: null,
  sourceDocumentId: "document-1",
  amount: "12.00",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.00",
  exchangeRate: "1",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  sourceDocument: {
    id: "document-1",
    version: 1,
    title: "Lunch",
    documentDate: "2026-09-11",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  },
};

describe("LedgerEntryCard", () => {
  it("renders an entry", () => {
    render(<LedgerEntryCard ledgerEntry={ledgerEntry} />);

    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("says nothing about the assignment run when the entry is not part of it", () => {
    render(<LedgerEntryCard ledgerEntry={ledgerEntry} />);

    expect(screen.queryByTestId("category-assignment-entry-label")).toBeNull();
    expect(screen.queryByTestId("source-document-processing-sweep")).toBeNull();
  });

  it("marks an entry the run is working on, like a document being processed", () => {
    const store = createCategoryAssignmentEntryStateStore();
    store.replace({ pendingIds: ["entry-1"], failedIds: [] });

    render(
      <CategoryAssignmentEntryStateContext.Provider value={store}>
        <LedgerEntryCard ledgerEntry={ledgerEntry} />
      </CategoryAssignmentEntryStateContext.Provider>
    );

    expect(screen.getByTestId("category-assignment-entry-label")).toHaveTextContent(
      batchActionsCopy.categoryEntryPending
    );
    expect(screen.getByTestId("source-document-processing-sweep")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-entry-card-root").className).toContain("bg-primary/5");
  });

  it("marks an entry the run could not place as failed, without the working animation", () => {
    const store = createCategoryAssignmentEntryStateStore();
    store.replace({ pendingIds: [], failedIds: ["entry-1"] });

    render(
      <CategoryAssignmentEntryStateContext.Provider value={store}>
        <LedgerEntryCard ledgerEntry={ledgerEntry} />
      </CategoryAssignmentEntryStateContext.Provider>
    );

    expect(screen.getByTestId("category-assignment-entry-label")).toHaveTextContent(
      batchActionsCopy.categoryEntryFailed
    );
    expect(screen.queryByTestId("source-document-processing-sweep")).toBeNull();
    expect(screen.getByTestId("ledger-entry-card-root").className).toContain("bg-danger/5");
  });

  it("marks the row inside a source document card the same way", () => {
    const store = createCategoryAssignmentEntryStateStore();
    store.replace({ pendingIds: ["entry-1"], failedIds: [] });

    render(
      <CategoryAssignmentEntryStateContext.Provider value={store}>
        <LedgerEntryItem ledgerEntry={ledgerEntry} />
      </CategoryAssignmentEntryStateContext.Provider>
    );

    expect(screen.getByTestId("category-assignment-entry-label")).toHaveTextContent(
      batchActionsCopy.categoryEntryPending
    );
  });
});
