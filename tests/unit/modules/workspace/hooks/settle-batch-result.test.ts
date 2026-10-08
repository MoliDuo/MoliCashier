import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchActionsCopy } from "@/copy/workspace";

const { toastSuccess, toastWarning } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, warning: toastWarning } }));

const { settleBatchResult } = await import("@/modules/workspace/hooks/settle-batch-result");

function selection() {
  return { exitSelectionMode: vi.fn(), retainSelection: vi.fn() };
}

const succeeded = (id: string) => ({ id, sourceDocumentId: "document" });
const failed = (id: string) => ({ id, code: "not_found" });

describe("settleBatchResult", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastWarning.mockReset();
  });

  it("leaves selection mode when every item went through", () => {
    const handlers = selection();

    settleBatchResult(
      { succeeded: [succeeded("a"), succeeded("b")], failed: [] },
      { successLabel: "done", ...handlers }
    );

    expect(handlers.exitSelectionMode).toHaveBeenCalledOnce();
    expect(handlers.retainSelection).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("done");
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("keeps only the failed items selected and says how many failed", () => {
    const handlers = selection();

    settleBatchResult(
      { succeeded: [succeeded("a")], failed: [failed("b")] },
      { successLabel: "done", ...handlers }
    );

    expect(handlers.exitSelectionMode).not.toHaveBeenCalled();
    expect(handlers.retainSelection).toHaveBeenCalledWith(["b"]);
    expect(toastSuccess).toHaveBeenCalledWith("done");
    expect(toastWarning).toHaveBeenCalledWith(
      batchActionsCopy.partialResult({ succeeded: 1, failed: 1 })
    );
  });

  it("reports no success when nothing went through", () => {
    const handlers = selection();

    settleBatchResult(
      { succeeded: [], failed: [failed("b")] },
      { successLabel: "done", ...handlers }
    );

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(handlers.retainSelection).toHaveBeenCalledWith(["b"]);
  });
});
