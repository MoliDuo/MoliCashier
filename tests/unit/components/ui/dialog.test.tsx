import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EditableField } from "@/components/ui/editable-field";
import { CalculatorInput } from "@/components/ui/calculator-input";

function DetailDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen} closeOnBack={false}>
      <DialogContent variant="detail" aria-describedby={undefined}>
        <DialogTitle>Detail</DialogTitle>
        <EditableField value="Lunch" onChange={vi.fn()} inputAriaLabel="title" />
        <CalculatorInput value="12" onChange={vi.fn()} ariaLabel="amount" />
      </DialogContent>
    </Dialog>
  );
}

describe("DialogContent Escape", () => {
  it("lets Esc cancel an inline title edit without closing the dialog", () => {
    render(<DetailDialog />);

    fireEvent.click(screen.getByText("Lunch"));
    const input = screen.getByRole("textbox", { name: "title" });
    fireEvent.change(input, { target: { value: "Dinner" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "title" })).not.toBeInTheDocument();
    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("lets Esc cancel an inline amount edit without closing the dialog", () => {
    render(<DetailDialog />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    const input = screen.getByRole("textbox", { name: "amount" });
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("12.00")).toBeInTheDocument();
  });

  it("still closes the dialog on Esc outside an inline editor", async () => {
    render(<DetailDialog />);

    fireEvent.keyDown(screen.getByText("Lunch"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
