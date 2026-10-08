import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loaderCalls, restoreFocus } = vi.hoisted(() => ({
  loaderCalls: vi.fn(),
  restoreFocus: vi.fn(),
}));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (
      loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
      options: { loading: React.ComponentType }
    ) =>
      function DynamicComponent(props: Record<string, unknown>) {
        const [Loaded, setLoaded] = React.useState<React.ComponentType<
          Record<string, unknown>
        > | null>(null);
        React.useEffect(() => {
          loaderCalls();
          void loader().then((module) => setLoaded(() => module.default));
        }, []);
        return Loaded == null ? <options.loading /> : <Loaded {...props} />;
      },
  };
});
vi.mock("@/modules/workspace/ui/DetailSheetLoadingFallback", () => ({
  DetailSheetLoadingFallback: () => <div>Loading detail</div>,
}));
vi.mock("@/modules/source-document/ui/SourceDocumentDetailModal", () => ({
  SourceDocumentDetailModal: ({
    id,
    open,
    onExitComplete,
  }: {
    id: string;
    open: boolean;
    onExitComplete: () => void;
  }) => (
    <div>
      <span>{`sheet ${id} ${open ? "open" : "closing"}`}</span>
      <button type="button" onClick={onExitComplete}>
        finish exit
      </button>
    </div>
  ),
}));
vi.mock("@/modules/ledger/navigation/ledger-detail-navigation", () => ({
  closeLedgerDetail: vi.fn(),
  restoreDetailReturnFocus: restoreFocus,
}));

import { DetailSheetHost } from "@/modules/workspace/ui/DetailSheetHost";

const props = {
  books: [],
  categories: [],
  mainCurrency: "CNY",
  preferredCurrencies: [],
  timeZone: "Asia/Shanghai",
};

afterEach(() => {
  loaderCalls.mockClear();
  restoreFocus.mockClear();
});

describe("DetailSheetHost", () => {
  it("loads nothing while the URL names no record", () => {
    render(<DetailSheetHost detailId={null} {...props} />);

    expect(loaderCalls).not.toHaveBeenCalled();
    expect(screen.queryByText("Loading detail")).not.toBeInTheDocument();
  });

  it("shows the record the URL names", async () => {
    render(<DetailSheetHost detailId="document-1" {...props} />);

    expect(await screen.findByText("sheet document-1 open")).toBeInTheDocument();
  });

  it("keeps a closed record mounted until its exit finishes, then hands focus back", async () => {
    const { rerender } = render(<DetailSheetHost detailId="document-1" {...props} />);
    await screen.findByText("sheet document-1 open");

    rerender(<DetailSheetHost detailId={null} {...props} />);
    expect(screen.getByText("sheet document-1 closing")).toBeInTheDocument();

    act(() => screen.getByRole("button", { name: "finish exit" }).click());
    await waitFor(() => expect(screen.queryByText(/sheet document-1/)).not.toBeInTheDocument());
    expect(restoreFocus).toHaveBeenCalledOnce();
  });

  it("swaps to a replacing record in place", async () => {
    const { rerender } = render(<DetailSheetHost detailId="document-1" {...props} />);
    await screen.findByText("sheet document-1 open");

    rerender(<DetailSheetHost detailId="document-2" {...props} />);

    expect(await screen.findByText("sheet document-2 open")).toBeInTheDocument();
    expect(screen.queryByText(/sheet document-1/)).not.toBeInTheDocument();
    expect(restoreFocus).not.toHaveBeenCalled();
  });
});
