import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectAmountVariant } from "tests/helpers/class-tables";
import type { LedgerEntryDto } from "@/modules/ledger/contracts";
import { EditableLedgerEntryItem } from "@/modules/source-document/ui/EditableLedgerEntryItem";

const amountDisplay = vi.hoisted(() => ({
  current: {
    converted: null as string | null,
    displayAmount: "18.00",
    isDifferentCurrency: false,
    status: "idle" as "idle" | "success",
    isLoading: false,
    isError: false,
    originalCurrency: "CNY",
    mainCurrency: "CNY",
  },
}));

vi.mock("@/modules/currency/hooks/useAmountDisplay", () => ({
  useAmountDisplay: () => amountDisplay.current,
}));

const entry: LedgerEntryDto = {
  id: "entry-1",
  categoryId: null,
  sourceDocumentId: "doc-1",
  amount: "18.00",
  currency: "CNY",
  itemName: "早餐",
  description: null,
  convertedAmount: "18.00",
  exchangeRate: "1",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

function renderItem(readOnly: boolean) {
  return render(
    <EditableLedgerEntryItem
      ledgerEntry={entry}
      categories={[]}
      categoryPlaceholder="选择分类"
      originalEntryDate="2026-09-10"
      readOnly={readOnly}
    />
  );
}

describe("EditableLedgerEntryItem currency control", () => {
  beforeEach(() => {
    amountDisplay.current = {
      converted: null,
      displayAmount: "18.00",
      isDifferentCurrency: false,
      status: "idle",
      isLoading: false,
      isError: false,
      originalCurrency: "CNY",
      mainCurrency: "CNY",
    };
  });

  it("shows the amount as plain, undimmed text when read-only", () => {
    renderItem(true);

    // Read-only is not "disabled": the figure is written exactly as an
    // editable one is, at full strength.
    const amount = screen.getByText("¥18.00");
    expectAmountVariant(amount, "item");
    expect(screen.queryByRole("button", { name: "货币" })).not.toBeInTheDocument();
  });

  it("exposes the currency dropdown only in the editable state", () => {
    renderItem(false);

    expect(screen.getByRole("button", { name: "货币" })).toBeInTheDocument();
  });

  it("stacks the converted amount above the original, like the stream rows", () => {
    amountDisplay.current = {
      converted: "72.00",
      displayAmount: "72.00",
      isDifferentCurrency: true,
      status: "success",
      isLoading: false,
      isError: false,
      originalCurrency: "USD",
      mainCurrency: "CNY",
    };
    renderItem(true);

    const converted = screen.getByText("¥72.00");
    expectAmountVariant(converted, "item");

    // The original amount is named by its currency code alone: the row already
    // reads as a converted one, so no "≈" marks the figure below.
    const original = screen.getByText((text) => text.startsWith("USD"));
    expectAmountVariant(original, "secondary");
    expect(original.textContent).toContain("USD");
    expect(original.textContent).not.toContain("≈");

    // The original sits below the converted amount.
    expect(
      converted.compareDocumentPosition(original) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("EditableLedgerEntryItem note", () => {
  it("offers a note on an editable row that has none", () => {
    renderItem(false);

    expect(screen.getByText("添加备注")).toBeInTheDocument();
  });

  it("hides the empty note on a read-only row", () => {
    renderItem(true);

    expect(screen.queryByText("添加备注")).not.toBeInTheDocument();
  });

  it("shows a cleared note as cleared rather than the saved one", () => {
    render(
      <EditableLedgerEntryItem
        ledgerEntry={{ ...entry, description: "加蛋" }}
        categories={[]}
        originalEntryDate="2026-09-10"
        pendingChanges={{ description: null }}
      />
    );

    expect(screen.queryByText("加蛋")).not.toBeInTheDocument();
    expect(screen.getByText("添加备注")).toBeInTheDocument();
  });
});
