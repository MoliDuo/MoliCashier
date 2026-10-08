/**
 * Application constants
 *
 * Centralized constants to avoid magic numbers throughout the codebase
 */

/**
 * The one locale dates, numbers and amounts are formatted in. The catalog is
 * Chinese only, so nothing reads a locale from the request.
 */
export const DISPLAY_LOCALE = "zh-CN";

// Time constants (seconds)
export const TIME_SECONDS = {
  DAY: 86400,
} as const;

// Ledger
export const LEDGER = {
  STALE_TIME_MS: 10 * 60 * 1000, // 10 minutes
} as const;

// UI
export const UI = {
  COPY_FEEDBACK_DURATION_MS: 2000, // 2 seconds
} as const;

// Query cache configuration
export const QUERY = {
  /** 默认staleTime - 5分钟 */
  DEFAULT_STALE_TIME_MS: 5 * 60 * 1000,
  /** 源文档staleTime - 2分钟（频繁变化但避免过度刷新） */
  SOURCE_DOC_STALE_TIME_MS: 2 * 60 * 1000,
} as const;
