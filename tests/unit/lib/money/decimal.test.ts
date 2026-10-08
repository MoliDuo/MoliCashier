import { describe, expect, it } from "vitest";
import {
  abs,
  add,
  allocate,
  compare,
  divide,
  isValidDecimal,
  multiply,
  normalize,
  normalizeDecimalInput,
  parse,
  round,
} from "@/lib/money/decimal";
import { getCurrencyDecimals, roundToCurrency } from "@/lib/money/currency-precision";

describe("decimal money operations", () => {
  it("performs exact arithmetic without binary floating-point loss", () => {
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(add("-10.50", "5.25")).toBe("-5.25");
    expect(multiply("0.01", "0.00012345")).toBe("0.0000012345");
    expect(divide("1", "7")).toBe("0.14285714285714285714");
  });

  it("compares and normalizes signed values", () => {
    expect([compare("1", "2"), compare("1.5", "1.5"), compare("3", "1")]).toEqual([-1, 0, 1]);
    expect(abs("-42.00")).toBe("42");
    expect(normalize("1.23000")).toBe("1.23");
    expect(normalize("1e2")).toBe("100");
    expect(normalize("-0.000")).toBe("0");
  });

  it("rounds half-up at money and exchange-rate precision", () => {
    const cases = [
      ["1.2345", 2, "1.23"],
      ["1.2355", 2, "1.24"],
      ["123.55", 0, "124"],
      ["1.2345", 3, "1.235"],
      ["1.23456789", 6, "1.234568"],
      ["-0.001", 2, "0"],
    ] as const;
    for (const [value, decimals, expected] of cases) {
      expect(round(value, decimals)).toBe(expected);
    }
  });

  it("allocates positive, negative, and equal-split amounts without losing the total", () => {
    const cases: Array<[string, number[]]> = [
      ["10.00", [1, 2, 2]],
      ["10.00", [0, 0, 0]],
      ["-10.00", [1, 1]],
    ];
    for (const [amount, ratios] of cases) {
      const parts = allocate(amount, ratios);
      expect(parts).toHaveLength(ratios.length);
      expect(parts.reduce((sum, value) => add(sum, value), "0")).toBe(normalize(amount));
    }
    expect(allocate("10.00", [1])).toEqual(["10.00"]);
    expect(allocate("10.00", [])).toEqual([]);
  });

  it("accepts plain decimal strings and rejects non-finite or alternate syntax", () => {
    for (const value of ["123.45", "0", "-10.50"]) expect(isValidDecimal(value)).toBe(true);
    for (const value of ["NaN", "Infinity", "-Infinity", "1e2", "1E-2", "abc", ""]) {
      expect(isValidDecimal(value)).toBe(false);
    }
  });

  it("parses string and number inputs", () => {
    expect(parse("123.45").toString()).toBe("123.45");
    expect(parse(123.45).toString()).toBe("123.45");
  });
});

describe("currency precision", () => {
  it("uses the currency's published minor-unit precision with a two-decimal fallback", () => {
    for (const currency of ["USD", "EUR", "GBP", "CNY", "AUD", "XYZ", ""]) {
      expect(getCurrencyDecimals(currency)).toBe(2);
    }
    for (const currency of ["JPY", "KRW", "VND", "CLP", "COP", "ISK"]) {
      expect(getCurrencyDecimals(currency)).toBe(0);
    }
    for (const currency of ["BHD", "JOD", "KWD", "OMR", "TND"]) {
      expect(getCurrencyDecimals(currency)).toBe(3);
    }
  });

  it("rounds amounts using the target currency precision", () => {
    expect(roundToCurrency("1.2355", "USD")).toBe("1.24");
    expect(roundToCurrency("123.45", "JPY")).toBe("123");
    expect(roundToCurrency("1.2345", "BHD")).toBe("1.235");
  });
});

describe("normalizeDecimalInput", () => {
  it.each([
    ["1.", "1"],
    [".5", "0.5"],
    ["-.5", "-0.5"],
    ["007", "7"],
    ["00.50", "0.50"],
    ["-007.", "-7"],
    [" 12.3 ", "12.3"],
    ["0", "0"],
  ])("reads the half-typed %j as %j", (input, expected) => {
    expect(normalizeDecimalInput(input)).toBe(expected);
  });

  it.each(["", "-", ".", "-.", "1e3", "1.2.3", "abc", null, undefined])(
    "reads %j as no amount",
    (input) => {
      expect(normalizeDecimalInput(input)).toBeNull();
    }
  );
});
