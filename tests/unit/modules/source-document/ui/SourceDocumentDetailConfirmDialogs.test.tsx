import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { commonCopy } from "@/copy/common";
import { sourceDocumentDetailCopy } from "@/copy/source-document";
import { SourceDocumentDetailConfirmDialogs } from "@/modules/source-document/ui/SourceDocumentDetailConfirmDialogs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function SourceDocumentDialogHarness({ onConfirm }: { onConfirm: () => Promise<boolean> }) {
  const [parentOpen, setParentOpen] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(true);
  return (
    <Dialog open={parentOpen} onOpenChange={setParentOpen}>
      <DialogContent variant="detail" aria-describedby={undefined}>
        <DialogTitle>Bill details</DialogTitle>
        <span>Parent content</span>
        <SourceDocumentDetailConfirmDialogs
          showBatchDeleteConfirm={confirmOpen}
          setShowBatchDeleteConfirm={setConfirmOpen}
          selectedCount={2}
          handleBatchDelete={onConfirm}
          pendingDeleteEntryId={null}
          setPendingDeleteEntryId={vi.fn()}
          handleDeleteEntry={async () => true}
          showDeleteConfirm={false}
          setShowDeleteConfirm={vi.fn()}
          handleDeleteDocument={async () => undefined}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("source-document dialog control flows", () => {
  it("locks a pending confirmation and closes after success", async () => {
    const confirmation = deferred<boolean>();
    render(<SourceDocumentDialogHarness onConfirm={() => confirmation.promise} />);

    fireEvent.click(screen.getByRole("button", { name: commonCopy.delete }));
    expect(screen.getByRole("button", { name: commonCopy.delete })).toBeDisabled();
    expect(screen.getByRole("button", { name: commonCopy.cancel })).toBeDisabled();

    confirmation.resolve(true);
    await waitFor(() =>
      expect(screen.queryByText(sourceDocumentDetailCopy.batchDeleteTitle)).not.toBeInTheDocument()
    );
    expect(screen.getByText("Parent content")).toBeInTheDocument();
  });

  it("keeps the confirmation open when the action returns false", async () => {
    render(<SourceDocumentDialogHarness onConfirm={async () => false} />);

    fireEvent.click(screen.getByRole("button", { name: commonCopy.delete }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: commonCopy.delete })).not.toBeDisabled()
    );
    expect(screen.getByText(sourceDocumentDetailCopy.batchDeleteTitle)).toBeInTheDocument();
  });

  it("closes only the nested confirmation when cancelled", async () => {
    render(<SourceDocumentDialogHarness onConfirm={async () => true} />);
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: commonCopy.cancel }));

    await waitFor(() => expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1));
    expect(screen.getByText("Parent content")).toBeInTheDocument();
  });
});
