"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Delete, Check, Equal, Calculator } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { parseTypedAmount, toFixedAmount, useCalculatorState } from "./use-calculator-state";
import { compare } from "@/lib/money/decimal";
import { calculatorCopy } from "@/copy/controls";

interface CalculatorInputProps {
  /** The amount as a decimal string. */
  value: string;
  /** Receives the new amount as a decimal string with `maxDecimals` places, rounded half-up. */
  onChange: (value: string) => void;
  displayClassName?: string;
  ariaLabel?: string;
  disabled?: boolean;
  allowNegative?: boolean;
  preserveDirection?: boolean;
  maxDecimals?: number;
}

type EditMode = "display" | "input" | "calculator";

export function CalculatorInput({
  value,
  onChange,
  displayClassName,
  ariaLabel: externalAriaLabel,
  disabled = false,
  allowNegative = false,
  preserveDirection = false,
  maxDecimals = 2,
}: CalculatorInputProps) {
  const ariaLabel = externalAriaLabel ?? calculatorCopy.amountAriaLabel;
  const [mode, setMode] = React.useState<EditMode>("display");
  const [inputValue, setInputValue] = React.useState<string>("");
  const [inputError, setInputError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const displayButtonRef = React.useRef<HTMLButtonElement>(null);
  /** Set when a key ends the inline edit, so focus returns to the amount it replaced. */
  const refocusDisplayRef = React.useRef(false);
  const errorId = React.useId();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const originalInputValueRef = React.useRef("");
  const committedRef = React.useRef(false);

  const isAllowed = React.useCallback(
    (nextValue: string): boolean => {
      const negative = compare(nextValue, "0") < 0;
      if (!allowNegative && negative) return false;
      if (!preserveDirection) return true;
      return compare(toFixedAmount(value, maxDecimals), "0") < 0 ? negative : !negative;
    },
    [allowNegative, maxDecimals, preserveDirection, value]
  );

  const calculator = useCalculatorState({
    value,
    maxDecimals,
    onConfirm: (nextValue) => {
      if (!isAllowed(nextValue)) {
        setInputError(calculatorCopy.invalidValue);
        return;
      }
      onChange(nextValue);
      setInputError(null);
      setMode("display");
    },
    onInvalid: () => setInputError(calculatorCopy.invalidValue),
  });

  // Focus input when entering input mode
  React.useEffect(() => {
    if (mode === "input" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    if (mode === "display" && refocusDisplayRef.current) {
      refocusDisplayRef.current = false;
      displayButtonRef.current?.focus();
    }
  }, [mode]);

  const confirmInputValue = React.useCallback((): boolean => {
    if (committedRef.current) return true;
    const nextValue = parseTypedAmount(inputValue, maxDecimals);
    if (nextValue !== null && isAllowed(nextValue)) {
      onChange(nextValue);
      committedRef.current = true;
      setInputError(null);
      setMode("display");
      return true;
    }

    setInputError(calculatorCopy.invalidValue);
    return false;
  }, [inputValue, isAllowed, maxDecimals, onChange]);

  React.useEffect(() => {
    if (mode !== "input") return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node) === false) {
        const didCommit = confirmInputValue();
        if (!didCommit) {
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirmInputValue, mode]);

  const handleStartInput = () => {
    committedRef.current = false;
    const fixed = toFixedAmount(value, maxDecimals);
    const nextInputValue = compare(fixed, "0") === 0 ? "" : fixed;
    originalInputValueRef.current = nextInputValue;
    setInputValue(nextInputValue);
    setInputError(null);
    setMode("input");
  };

  const handleOpenCalculator = () => {
    // The input unmounts here; its blur must not commit the half-edited draft.
    committedRef.current = true;
    calculator.reset();
    setMode("calculator");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      refocusDisplayRef.current = true;
      if (!confirmInputValue()) refocusDisplayRef.current = false;
    } else if (e.key === "Escape") {
      e.preventDefault();
      refocusDisplayRef.current = true;
      setInputValue(originalInputValueRef.current);
      setInputError(null);
      setMode("display");
    }
  };

  const handleInputBlur = () => {
    const didCommit = confirmInputValue();
    if (!didCommit) requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    const decimalPattern = new RegExp(
      `^${allowNegative ? "-?" : ""}\\d*(?:\\.\\d{0,${maxDecimals}})?$`
    );
    if (newValue === "" || decimalPattern.test(newValue)) {
      setInputValue(newValue);
      setInputError(null);
    }
  };

  const buttonBase =
    "h-12 rounded-lg font-medium transition-[color,background-color,border-color,opacity,transform] duration-[var(--motion-press)] active:scale-[0.97]";
  const numberBtn = cn(buttonBase, "bg-surface2 hover:bg-surface2/80 text-text");
  const operatorBtn = cn(
    buttonBase,
    "bg-primary/10 hover:bg-primary/20 text-primary font-semibold"
  );
  const functionBtn = cn(buttonBase, "bg-muted/10 hover:bg-muted/20 text-muted-foreground");
  const confirmBtn = cn(buttonBase, "bg-primary hover:bg-primary/90 text-white");

  // Display mode: clickable amount
  if (mode === "display") {
    return (
      <button
        ref={displayButtonRef}
        type="button"
        className={cn(
          "cursor-pointer hover:opacity-80 transition-opacity",
          displayClassName,
          disabled && "pointer-events-none opacity-50"
        )}
        disabled={disabled}
        onClick={handleStartInput}
        aria-label={ariaLabel}
      >
        <span className="tabular-nums">{toFixedAmount(value, maxDecimals)}</span>
      </button>
    );
  }

  // Input mode: inline input with calculator button
  if (mode === "input") {
    return (
      // Esc cancels this edit; a dialog around it stays open.
      <div ref={containerRef} data-escape-cancels="">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            aria-label={ariaLabel}
            aria-invalid={inputError !== null}
            aria-describedby={inputError === null ? undefined : errorId}
            className={cn(
              "w-28 border-0 bg-transparent p-0 text-center tabular-nums shadow-none sm:w-32",
              displayClassName
            )}
          />
          <button
            type="button"
            // Keep focus on the input so pressing the button does not blur (and commit) it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleOpenCalculator}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
            title={calculatorCopy.openCalculator}
            aria-label={calculatorCopy.openCalculator}
          >
            <Calculator className="h-4 w-4" />
          </button>
        </div>
        {inputError === null ? null : (
          <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
            {inputError}
          </p>
        )}
      </div>
    );
  }

  // Calculator mode: dialog with calculator
  return (
    <Dialog open={mode === "calculator"} onOpenChange={(open) => !open && setMode("display")}>
      <DialogContent
        variant="modal"
        className="w-72 max-w-[calc(100vw-2rem)] p-4 gap-0 [&>button:last-child]:hidden"
        aria-describedby={undefined}
        onKeyDown={calculator.handleKeyDown}
        onCloseAutoFocus={(event) => {
          // The opener unmounted with the inline input; return focus to the amount.
          event.preventDefault();
          displayButtonRef.current?.focus();
        }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{calculatorCopy.title}</DialogTitle>
        </VisuallyHidden.Root>

        {/* Expression Display */}
        <div className="mb-2 h-6 text-right">
          {calculator.expression !== "" && (
            <span className="text-sm text-muted-foreground tabular-nums truncate block">
              {calculator.expression}
            </span>
          )}
        </div>

        {/* Result Display */}
        <div className="mb-4 text-right">
          <span
            className={cn(
              "text-3xl font-bold tabular-nums",
              calculator.state.hasResult ? "text-primary" : "text-text"
            )}
          >
            {calculator.state.error ? calculatorCopy.error : calculator.state.displayValue}
          </span>
          {inputError === null ? null : (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {inputError}
            </p>
          )}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={calculator.handleClear}
            aria-label={calculatorCopy.clearAllLabel}
            className={functionBtn}
          >
            {calculatorCopy.clearAll}
          </button>
          <button
            type="button"
            onClick={calculator.handleDelete}
            aria-label={calculatorCopy.delete}
            className={cn(functionBtn, "col-span-2")}
          >
            <Delete aria-hidden="true" className="h-5 w-5 mx-auto" />
          </button>
          <button
            type="button"
            onClick={() => calculator.handleOperator("÷")}
            aria-label={calculatorCopy.divide}
            className={operatorBtn}
          >
            ÷
          </button>

          <button type="button" onClick={() => calculator.handleNumber("7")} className={numberBtn}>
            7
          </button>
          <button type="button" onClick={() => calculator.handleNumber("8")} className={numberBtn}>
            8
          </button>
          <button type="button" onClick={() => calculator.handleNumber("9")} className={numberBtn}>
            9
          </button>
          <button
            type="button"
            onClick={() => calculator.handleOperator("×")}
            aria-label={calculatorCopy.multiply}
            className={operatorBtn}
          >
            ×
          </button>

          <button type="button" onClick={() => calculator.handleNumber("4")} className={numberBtn}>
            4
          </button>
          <button type="button" onClick={() => calculator.handleNumber("5")} className={numberBtn}>
            5
          </button>
          <button type="button" onClick={() => calculator.handleNumber("6")} className={numberBtn}>
            6
          </button>
          <button
            type="button"
            onClick={() => calculator.handleOperator("-")}
            aria-label={calculatorCopy.subtract}
            className={operatorBtn}
          >
            −
          </button>

          <button type="button" onClick={() => calculator.handleNumber("1")} className={numberBtn}>
            1
          </button>
          <button type="button" onClick={() => calculator.handleNumber("2")} className={numberBtn}>
            2
          </button>
          <button type="button" onClick={() => calculator.handleNumber("3")} className={numberBtn}>
            3
          </button>
          <button
            type="button"
            onClick={() => calculator.handleOperator("+")}
            aria-label={calculatorCopy.add}
            className={operatorBtn}
          >
            +
          </button>

          <button
            type="button"
            onClick={() => calculator.handleNumber("0")}
            className={cn(numberBtn, "col-span-2")}
          >
            0
          </button>
          <button type="button" onClick={calculator.handleDecimal} className={numberBtn}>
            .
          </button>
          {calculator.showEqualsButton ? (
            <button
              type="button"
              onClick={calculator.handleEquals}
              aria-label={calculatorCopy.calculate}
              className={confirmBtn}
            >
              <Equal aria-hidden="true" className="h-5 w-5 mx-auto" />
            </button>
          ) : (
            <button
              type="button"
              onClick={calculator.handleConfirm}
              aria-label={calculatorCopy.confirm}
              className={confirmBtn}
            >
              <Check aria-hidden="true" className="h-5 w-5 mx-auto" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
