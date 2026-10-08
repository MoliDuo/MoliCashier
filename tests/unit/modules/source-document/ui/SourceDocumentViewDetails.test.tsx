import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { SourceDocumentViewDetails } from "@/modules/source-document/ui/SourceDocumentViewDetails";

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ComponentProps<"img"> & {
    fill?: boolean;
    unoptimized?: boolean;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt ?? ""} />
  ),
}));

vi.mock("@/modules/source-document/ui/SourceDocumentImageModal", () => ({
  SourceDocumentImageModal: ({
    open,
    initialIndex,
    images,
  }: {
    open: boolean;
    initialIndex: number;
    images: Array<{ storedFileId?: string }>;
  }) => (
    <div
      data-testid="image-viewer-state"
      data-open={open}
      data-index={initialIndex}
      data-file-ids={images.map((image) => image.storedFileId).join(",")}
    />
  ),
}));

vi.mock("@/modules/source-document/ui/EditableLedgerEntryItem", () => ({
  EditableLedgerEntryItem: ({
    ledgerEntry,
    pendingChanges,
    readOnly,
    onDelete,
  }: {
    ledgerEntry: LedgerEntry;
    pendingChanges?: { itemName?: string };
    readOnly?: boolean;
    onDelete?: () => void;
  }) => (
    <div>
      <input
        aria-label="Entry name"
        data-editable={!readOnly}
        value={pendingChanges?.itemName ?? ledgerEntry.itemName}
        readOnly
      />
      {onDelete != null ? <button onClick={onDelete}>delete-row</button> : null}
    </div>
  ),
}));

function documentWithFiles(count: number): SourceDocument {
  return {
    id: "doc-1",
    version: 1,
    latestAttemptId: null,
    title: "Receipt",
    text: null,
    files: Array.from({ length: count }, (_, index) => ({
      id: `file-${index + 1}`,
      contentType: "image/png",
      byteSize: 100,
      originalFilename: `${index + 1}.png`,
    })),
    processingStatus: "completed",
    failureKind: null,
    failureMessage: null,
    documentDate: "2026-07-28",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    supportedActions: [],
    ledgerEntries: [],
    hasImages: count > 0,
    canEdit: true,
    errorCode: null,
  };
}

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

const entry = (id: string, itemName: string): LedgerEntry => ({
  id,
  categoryId: null,
  sourceDocumentId: "doc-1",
  amount: "12.00",
  currency: "CNY",
  itemName,
  description: null,
  convertedAmount: "12.00",
  exchangeRate: "1",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
});

type DetailsProps = Parameters<typeof SourceDocumentViewDetails>[0];

function detailsProps(overrides: Partial<DetailsProps> = {}): DetailsProps {
  return {
    sourceDocument: documentWithFiles(0),
    ledgerEntries: [],
    pendingEntries: {},
    savingEntryIds: [],
    documentDate: "2026-07-28",
    categories: [],
    selectedEntryIds: [],
    isSelectionMode: false,
    mobileView: "details",
    onEntryChange: vi.fn(),
    onSelectEntry: vi.fn(),
    onToggleSelectionMode: vi.fn(),
    readOnly: false,
    isAddingEntry: false,
    onAddEntry: vi.fn(),
    onDeleteEntry: vi.fn(),
    ...overrides,
  };
}

function renderDetails(count: number, overrides: Partial<DetailsProps> = {}) {
  return renderWithQueryClient(
    <SourceDocumentViewDetails
      {...detailsProps({ sourceDocument: documentWithFiles(count), ...overrides })}
    />
  );
}

describe("SourceDocumentViewDetails entries", () => {
  it("names the entries and counts them in the card header", () => {
    renderDetails(0, { ledgerEntries: [entry("entry-1", "Lunch")] });

    expect(screen.getByTestId("source-document-entries-header")).toHaveTextContent("明细1");
  });

  it("opens a row for editing when it is tapped, with its delete at the end", () => {
    const onDeleteEntry = vi.fn();
    renderDetails(0, { ledgerEntries: [entry("entry-1", "Lunch")], onDeleteEntry });

    const name = screen.getByDisplayValue("Lunch");
    expect(name).toHaveAttribute("data-editable", "false");
    expect(screen.queryByText("delete-row")).not.toBeInTheDocument();

    fireEvent.click(name);
    expect(screen.getByDisplayValue("Lunch")).toHaveAttribute("data-editable", "true");
    fireEvent.click(screen.getByText("delete-row"));
    expect(onDeleteEntry).toHaveBeenCalledWith("entry-1");
  });

  it("keeps a row closed while its write is in flight, showing the value being written", () => {
    renderDetails(0, {
      ledgerEntries: [entry("entry-1", "Lunch")],
      pendingEntries: { "entry-1": { itemName: "Brunch" } },
      savingEntryIds: ["entry-1"],
    });

    fireEvent.click(screen.getByDisplayValue("Brunch"));
    expect(screen.getByDisplayValue("Brunch")).toHaveAttribute("data-editable", "false");
  });

  it("always offers a new entry on an editable record", () => {
    const onAddEntry = vi.fn();
    renderDetails(0, { onAddEntry });

    fireEvent.click(screen.getByRole("button", { name: "添加明细" }));
    expect(onAddEntry).toHaveBeenCalledOnce();
  });

  it("offers neither editing nor selection on a read-only record", () => {
    renderDetails(0, { ledgerEntries: [entry("entry-1", "Lunch")], readOnly: true });

    fireEvent.click(screen.getByDisplayValue("Lunch"));
    expect(screen.getByDisplayValue("Lunch")).toHaveAttribute("data-editable", "false");
    expect(screen.queryByRole("button", { name: "添加明细" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("选择")).not.toBeInTheDocument();
  });
});

describe("SourceDocumentViewDetails image stage", () => {
  it("shows an evidence empty state without hiding the details pane", () => {
    renderDetails(0);
    expect(screen.getByText(/暂无原始凭证|No original evidence/i)).toBeInTheDocument();
    expect(screen.getByTestId("source-document-details-pane")).not.toHaveClass("hidden");
  });

  it("shows a single image whole, without an inner scroll or a thumbnail grid", () => {
    renderDetails(1);
    const stage = screen.getByTestId("source-document-image-stage");
    expect(stage).not.toHaveClass("overflow-y-auto");
    expect(stage.className).not.toMatch(/aspect-/);
    expect(stage.querySelector("img")).toHaveClass("max-h-[70dvh]", "object-contain");
    expect(screen.queryByTestId("source-document-image-grid")).not.toBeInTheDocument();
    expect(stage.querySelector("img")).toHaveAttribute("src", "/api/stored-files/file-1");
    expect(stage.querySelector("img")).not.toHaveAttribute("src", expect.stringContaining("blob:"));
    expect(screen.getAllByRole("button", { name: /图片 1|image 1/i })).toHaveLength(1);
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-file-ids", "file-1");
  });

  it("shows several images as thumbnails and opens the viewer at the clicked one", () => {
    renderDetails(2);
    expect(screen.queryByTestId("source-document-image-stage")).not.toBeInTheDocument();
    expect(screen.getByTestId("source-document-image-grid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /图片 2|image 2/i }));
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute("data-index", "1");
    expect(screen.getByTestId("image-viewer-state")).toHaveAttribute(
      "data-file-ids",
      "file-1,file-2"
    );
  });

  it("shows only the evidence pane when the narrow view asks for it", () => {
    renderDetails(1, { mobileView: "evidence" });

    expect(screen.getByTestId("source-document-details-pane")).toHaveClass("hidden", "lg:block");
  });
});

describe("SourceDocumentViewDetails selection", () => {
  it("switches into selection from the card header", () => {
    const onToggleSelectionMode = vi.fn();
    renderDetails(0, { ledgerEntries: [entry("entry-1", "Lunch")], onToggleSelectionMode });

    fireEvent.click(screen.getByTitle("选择"));
    expect(onToggleSelectionMode).toHaveBeenCalledTimes(1);
  });

  it("freezes the rows while selecting and keeps values being written", () => {
    const onSelectEntry = vi.fn();
    const props = detailsProps({
      ledgerEntries: [entry("entry-1", "Lunch")],
      pendingEntries: { "entry-1": { itemName: "Edited lunch" } },
      onSelectEntry,
    });
    const queryClient = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SourceDocumentViewDetails {...props} isSelectionMode />
      </QueryClientProvider>
    );

    const input = screen.getByDisplayValue("Edited lunch");
    expect(input.closest("[inert]")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: /Lunch/i });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(checkbox);
    expect(onSelectEntry).toHaveBeenCalledWith("entry-1", true);
    expect(screen.queryByRole("button", { name: "添加明细" })).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <SourceDocumentViewDetails {...props} isSelectionMode={false} />
      </QueryClientProvider>
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Edited lunch").closest("[inert]")).toBeNull();
  });
});

describe("SourceDocumentViewDetails entry row outline", () => {
  it("does not clip a selected entry's outline down to its top and bottom edges", () => {
    // Regression: the entries card clipped its rows, and the outline is drawn
    // one pixel outside the row — on the card's own border — so a selected row
    // lost both verticals and read as two stray strips above and below it.
    const { container } = renderDetails(0, {
      ledgerEntries: [entry("entry-1", "Lunch")],
      selectedEntryIds: ["entry-1"],
      isSelectionMode: true,
    });

    const card = screen.getByTestId("source-document-entries-header").parentElement as HTMLElement;
    expect(card).not.toHaveClass("overflow-hidden");
    expect(
      container.querySelector('[data-selection-mode="true"][data-selected="true"]')
    ).toHaveClass("ring-1", "ring-primary");
  });
});
