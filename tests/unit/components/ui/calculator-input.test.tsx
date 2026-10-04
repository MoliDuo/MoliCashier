import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CalculatorInput } from "@/components/ui/calculator-input";

describe("CalculatorInput", () => {
  it("initializes a new inline draft from the latest controlled value", () => {
    const { rerender } = render(<CalculatorInput value={12} onChange={() => {}} />);

    rerender(<CalculatorInput value={34.5} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "金额" }));

    expect(screen.getByRole("textbox")).toHaveValue("34.50");
  });

  it("commits valid inline values on Enter and blur", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "18.25" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(18.25);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "19.75" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenLastCalledWith(19.75);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("edits negative values when explicitly enabled", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={-8} onChange={onChange} ariaLabel="amount" allowNegative />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "-6.25" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(-6.25);
  });

  it("keeps a negative value in the deduction direction", () => {
    const onChange = vi.fn();
    render(
      <CalculatorInput
        value={-8}
        onChange={onChange}
        ariaLabel="amount"
        allowNegative
        preserveDirection
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "6.25" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("请输入有效金额。");
  });

  it("preserves configured three-decimal precision", () => {
    const onChange = vi.fn();
    render(
      <CalculatorInput
        value={-0.123}
        onChange={onChange}
        ariaLabel="amount"
        allowNegative
        maxDecimals={3}
      />
    );

    expect(screen.getByText("-0.123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.blur(screen.getByRole("textbox"));

    expect(onChange).toHaveBeenCalledWith(-0.123);
  });

  it("commits once when an outside mousedown is followed by blur", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "19.75" } });
    fireEvent.mouseDown(document.body);
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(19.75);
  });

  it("keeps invalid inline input open and announces an error on outside click", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.mouseDown(document.body);

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入有效金额。");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restores the controlled value when inline editing is cancelled with Escape", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "99.00" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("12.00")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not commit the draft when the calculator button is pressed", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12.5} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "19.75" } });

    const opener = screen.getByRole("button", { name: "打开计算器" });
    // preventDefault on mousedown stops the browser from moving focus off the input.
    expect(fireEvent.mouseDown(opener)).toBe(false);
    fireEvent.click(opener);
    fireEvent.blur(screen.getByRole("dialog"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("submits a complete calculator expression with Enter", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={12} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.click(screen.getByRole("button", { name: "打开计算器" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(15);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("normalizes backspacing the final calculator digit to zero", () => {
    const onChange = vi.fn();
    render(<CalculatorInput value={0} onChange={onChange} ariaLabel="amount" />);

    fireEvent.click(screen.getByRole("button", { name: "amount" }));
    fireEvent.click(screen.getByRole("button", { name: "打开计算器" }));
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Backspace" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(0);
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("labels the amount, opener, and dialog from the catalog", () => {
    render(<CalculatorInput value={42} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "金额" }));
    fireEvent.click(screen.getByRole("button", { name: "打开计算器" }));

    expect(screen.getByText("计算器")).toBeInTheDocument();
  });
});
