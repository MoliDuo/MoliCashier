"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchConvertedAmount } from "@/modules/currency/queries";
import type { ConvertCurrencyResult } from "../contracts";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { formatDateTimeForApi } from "@/lib/date-utils";
import { isValidDecimal } from "@/lib/money/decimal";

export type UseConvertedAmountReturn =
  | { status: "idle"; converted: string }
  | { status: "loading"; converted: null }
  | { status: "success"; converted: string }
  | { status: "error"; converted: null; error: Error };

export interface UseConvertedAmountOptions {
  /** Disable the live conversion query (e.g. when a persisted value is authoritative). */
  enabled?: boolean;
}

const supportedCurrencySet = new Set<string>(SUPPORTED_CURRENCIES);
const CIVIL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function resolveConversionDate(date?: string | null): string | null {
  if (date == null || date === "") return formatDateTimeForApi(new Date());
  if (CIVIL_DATE_PATTERN.test(date)) {
    const parsed = new Date(`${date}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && formatDateTimeForApi(parsed) === date ? date : null;
  }
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : formatDateTimeForApi(parsed);
}

export function useConvertedAmount(
  amount: string,
  from: string | null | undefined,
  to: string | null | undefined,
  date?: string | null,
  options: UseConvertedAmountOptions = {}
): UseConvertedAmountReturn {
  const normalizedFrom = from != null && supportedCurrencySet.has(from) ? from : null;
  const normalizedTo = to != null && supportedCurrencySet.has(to) ? to : null;
  const conversionDate = resolveConversionDate(date);
  const localToday = formatDateTimeForApi(new Date());

  const isSameCurrency = normalizedFrom != null && normalizedFrom === normalizedTo;
  const isMissingInfo =
    !isValidDecimal(amount) ||
    normalizedFrom == null ||
    normalizedTo == null ||
    conversionDate == null;
  const canConvert = options.enabled !== false && !isSameCurrency && !isMissingInfo;

  const { data, isLoading, error } = useQuery<ConvertCurrencyResult>({
    queryKey: queryKeys.convert(
      amount,
      normalizedFrom ?? "__missing_from__",
      normalizedTo ?? "__missing_to__",
      conversionDate ?? "__invalid_date__"
    ),
    queryFn: async ({ signal }) => {
      if (normalizedFrom == null || normalizedTo == null) {
        return { converted: amount };
      }

      const result = await fetchConvertedAmount(
        {
          amount,
          from: normalizedFrom,
          to: normalizedTo,
          ...(conversionDate != null ? { date: conversionDate } : {}),
        },
        { signal }
      );
      if (typeof result.converted !== "string" || !isValidDecimal(result.converted)) {
        throw new Error("Invalid currency conversion result");
      }
      return result;
    },
    enabled: canConvert,
    // Historical dates are immutable; only today's "live" conversion may
    // change within a day, so it is kept fresh for one hour.
    staleTime: conversionDate === localToday ? 1000 * 60 * 60 : Infinity,
  });

  if (!canConvert) {
    return {
      status: "idle",
      converted: amount,
    };
  }

  if (isLoading) {
    return { status: "loading", converted: null };
  }

  if (error != null) {
    return { status: "error", converted: null, error };
  }

  return {
    status: "success",
    converted: data?.converted ?? amount,
  };
}
