import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchSourceDocumentInputMock } = vi.hoisted(() => ({
  fetchSourceDocumentInputMock: vi.fn(),
}));

vi.mock("@/modules/source-document/queries", () => ({
  fetchSourceDocumentInput: fetchSourceDocumentInputMock,
}));
vi.mock("@/modules/source-document/ui/SourceDocumentInput", () => ({
  SourceDocumentInput: ({ onPendingChange }: { onPendingChange: (pending: boolean) => void }) => (
    <div data-testid="retry-input">
      <button onClick={() => onPendingChange(true)}>submit</button>
      <button onClick={() => onPendingChange(false)}>settle</button>
    </div>
  ),
}));

import { SourceDocumentEditRetryDialog } from "@/modules/source-document/ui/SourceDocumentEditRetryDialog";

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SourceDocumentEditRetryDialog
        sourceDocument={{
          id: "00000000-0000-4000-8000-000000000001",
          latestAttemptId: null,
          text: null,
          files: [],
          hasImages: true,
        }}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe("SourceDocumentEditRetryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSourceDocumentInputMock.mockRejectedValue(new Error("unavailable"));
  });

  it("renders the load error and reloads without mounting an incomplete input", async () => {
    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载原始凭证");
    expect(screen.queryByTestId("retry-input")).not.toBeInTheDocument();

    fetchSourceDocumentInputMock.mockResolvedValue({ text: "receipt", files: [] });
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByTestId("retry-input")).toBeInTheDocument());
  });

  it("closes without asking, but not while the retry is submitting", async () => {
    fetchSourceDocumentInputMock.mockResolvedValue({ text: "receipt", files: [] });
    const onOpenChange = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <SourceDocumentEditRetryDialog
          sourceDocument={{ id: "source-1", latestAttemptId: null, text: "Original" }}
          open
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>
    );
    await screen.findByTestId("retry-input");

    fireEvent.click(screen.getByRole("button", { name: "submit" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "settle" }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "放弃更改？" })).not.toBeInTheDocument();
  });
});
