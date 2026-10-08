"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { parse } from "@/lib/money/decimal";

type Operator = "+" | "-" | "×" | "÷" | null;

interface CalculatorState {
  /** The left operand or result, a decimal string while typing ("12.", "0.5"). */
  displayValue: string;
  operator: Operator;
  operand: string;
  hasResult: boolean;
  /** Set by a division by zero; the display shows the error until a new number starts. */
  error: boolean;
}

interface UseCalculatorStateOptions {
  value: string;
  maxDecimals?: number;
  onConfirm: (value: string) => void;
  onInvalid: () => void;
}

/**
 * The amount as a fixed decimal string, rounded half-up like the server's
 * `roundToCurrency`. Plain decimals, never exponent notation; an invalid value
 * reads as zero.
 */
export function toFixedAmount(value: string, maxDecimals: number): string {
  try {
    const rounded = parse(value).toDecimalPlaces(maxDecimals);
    return (rounded.isZero() ? rounded.abs() : rounded).toFixed(maxDecimals);
  } catch {
    return parse(0).toFixed(maxDecimals);
  }
}

/** A typed amount ("1.", ".5", "-3") as a fixed decimal string, or null when it is not a number. */
export function parseTypedAmount(value: string, maxDecimals: number): string | null {
  if (value.trim() === "") return null;
  try {
    return toFixedAmount(parse(value).toFixed(), maxDecimals);
  } catch {
    return null;
  }
}

function initialCalculatorState(value: string, maxDecimals: number): CalculatorState {
  const fixed = toFixedAmount(value, maxDecimals);
  return {
    displayValue: parse(fixed).isZero() ? "0" : fixed,
    operator: null,
    operand: "",
    hasResult: false,
    error: false,
  };
}

/** A result rounded half-up to the currency's decimals, with trailing zeros dropped. */
function formatResult(value: string, maxDecimals: number): string {
  const rounded = parse(value).toDecimalPlaces(maxDecimals);
  return rounded.isZero() ? "0" : rounded.toFixed();
}

/** The result as a decimal string, or null for a division by zero. */
function calculate(a: string, operator: Operator, b: string): string | null {
  const left = parse(a);
  switch (operator) {
    case "+":
      return left.plus(b).toFixed();
    case "-":
      return left.minus(b).toFixed();
    case "×":
      return left.times(b).toFixed();
    case "÷":
      return parse(b).isZero() ? null : left.dividedBy(b).toFixed();
    default:
      return null;
  }
}

const ERROR_STATE: CalculatorState = {
  displayValue: "0",
  operator: null,
  operand: "",
  hasResult: true,
  error: true,
};

export function useCalculatorState({
  value,
  maxDecimals = 2,
  onConfirm,
  onInvalid,
}: UseCalculatorStateOptions) {
  const [state, setState] = useState<CalculatorState>(() =>
    initialCalculatorState(value, maxDecimals)
  );

  const reset = useCallback(() => {
    setState(initialCalculatorState(value, maxDecimals));
  }, [maxDecimals, value]);

  const handleNumber = useCallback((digit: string) => {
    setState((previous) => {
      if (previous.hasResult) {
        return { displayValue: digit, operator: null, operand: "", hasResult: false, error: false };
      }
      if (previous.operator === null) {
        const displayValue = previous.displayValue === "0" ? digit : previous.displayValue + digit;
        return { ...previous, displayValue };
      }
      const operand =
        previous.operand === "" || previous.operand === "0" ? digit : previous.operand + digit;
      return { ...previous, operand };
    });
  }, []);

  const handleDecimal = useCallback(() => {
    setState((previous) => {
      if (previous.hasResult) {
        return { displayValue: "0.", operator: null, operand: "", hasResult: false, error: false };
      }
      if (previous.operator === null && !previous.displayValue.includes(".")) {
        return { ...previous, displayValue: `${previous.displayValue}.` };
      }
      if (previous.operator !== null && !previous.operand.includes(".")) {
        return {
          ...previous,
          operand: previous.operand === "" ? "0." : `${previous.operand}.`,
        };
      }
      return previous;
    });
  }, []);

  const handleOperator = useCallback(
    (operator: Exclude<Operator, null>) => {
      setState((previous) => {
        // Nothing to operate on after a division by zero; a new number starts over.
        if (previous.error) return previous;
        if (previous.hasResult) {
          return { ...previous, operator, operand: "", hasResult: false };
        }
        if (previous.operator !== null && previous.operand !== "") {
          const result = calculate(previous.displayValue, previous.operator, previous.operand);
          if (result === null) return ERROR_STATE;
          return {
            displayValue: formatResult(result, maxDecimals),
            operator,
            operand: "",
            hasResult: false,
            error: false,
          };
        }
        return { ...previous, operator, operand: "" };
      });
    },
    [maxDecimals]
  );

  const handleEquals = useCallback(() => {
    setState((previous) => {
      if (previous.operator === null || previous.operand === "") return previous;
      const result = calculate(previous.displayValue, previous.operator, previous.operand);
      if (result === null) return ERROR_STATE;
      return {
        displayValue: formatResult(result, maxDecimals),
        operator: null,
        operand: "",
        hasResult: true,
        error: false,
      };
    });
  }, [maxDecimals]);

  const handleClear = useCallback(() => {
    setState({ displayValue: "0", operator: null, operand: "", hasResult: false, error: false });
  }, []);

  const handleDelete = useCallback(() => {
    setState((previous) => {
      if (previous.hasResult) return initialCalculatorState(value, maxDecimals);
      if (previous.operator === null) {
        const sliced = previous.displayValue.slice(0, -1);
        const displayValue = sliced === "" || sliced === "." || sliced === "-" ? "0" : sliced;
        return { ...previous, displayValue };
      }
      if (previous.operand !== "") {
        return { ...previous, operand: previous.operand.slice(0, -1) };
      }
      return { ...previous, operator: null };
    });
  }, [maxDecimals, value]);

  const handleConfirm = useCallback(() => {
    if (state.error) {
      onInvalid();
      return;
    }
    onConfirm(toFixedAmount(state.displayValue, maxDecimals));
  }, [maxDecimals, onConfirm, onInvalid, state.displayValue, state.error]);

  const handleSubmit = useCallback(() => {
    if (state.operator === null) {
      handleConfirm();
      return;
    }
    if (state.operand === "") {
      onInvalid();
      return;
    }
    const result = calculate(state.displayValue, state.operator, state.operand);
    if (result === null) {
      setState(ERROR_STATE);
      onInvalid();
      return;
    }
    onConfirm(toFixedAmount(result, maxDecimals));
  }, [
    handleConfirm,
    maxDecimals,
    onConfirm,
    onInvalid,
    state.displayValue,
    state.operand,
    state.operator,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // A focused keypad button presses itself on Enter and Space; every other
      // key still types into the calculator.
      if (
        event.target instanceof HTMLButtonElement &&
        (event.key === "Enter" || event.key === " ")
      ) {
        return;
      }
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handleNumber(event.key);
      } else if (event.key === ".") {
        event.preventDefault();
        handleDecimal();
      } else if (["+", "-", "*", "/"].includes(event.key)) {
        event.preventDefault();
        const operators: Record<string, Exclude<Operator, null>> = {
          "+": "+",
          "-": "-",
          "*": "×",
          "/": "÷",
        };
        handleOperator(operators[event.key]!);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
      } else if (event.key === "Delete") {
        event.preventDefault();
        handleClear();
      } else if (event.key === "Enter") {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleClear, handleDecimal, handleDelete, handleNumber, handleOperator, handleSubmit]
  );

  const expression = useMemo(() => {
    if (state.operator !== null && state.operand !== "") {
      return `${state.displayValue} ${state.operator} ${state.operand}`;
    }
    if (state.operator !== null) return `${state.displayValue} ${state.operator}`;
    return "";
  }, [state.displayValue, state.operand, state.operator]);

  return {
    state,
    expression,
    showEqualsButton: state.operator !== null && state.operand !== "" && !state.hasResult,
    reset,
    handleNumber,
    handleDecimal,
    handleOperator,
    handleEquals,
    handleClear,
    handleDelete,
    handleConfirm,
    handleKeyDown,
  };
}
