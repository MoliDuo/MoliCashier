import type { EnhancedStatsDto } from "@/modules/stats/contracts";

/**
 * The statistics payload a stats surface renders. Both the tab and the content
 * view need a whole `EnhancedStatsDto` to render anything at all, and they need
 * the same one, so the shape lives here rather than being spelled out twice and
 * drifting when the contract grows a field.
 */
export function buildEnhancedStatsFixture(
  overrides: Partial<EnhancedStatsDto> = {}
): EnhancedStatsDto {
  return {
    range: { from: "2026-08-01", to: "2026-08-06" },
    // A period that is over unless a test says otherwise, so nothing is forecast.
    periodEnd: "2026-08-06",
    unconvertedCount: 0,
    summary: {
      total: "120",
      currency: "CNY",
      dailyAverage: "20",
      comparison: {
        mode: "same_period",
        from: "2026-07-01",
        to: "2026-07-06",
        previousTotal: "60",
        amountDelta: "60",
        percent: 100,
        wholeTo: "2026-07-06",
        previousWholeTotal: "60",
      },
    },
    categories: [],
    previousOnlyCategories: [],
    chart: [],
    previousChart: [],
    largestEntries: [],
    heatmap: {
      days: [],
      stats: { minAmount: "0", maxAmount: "0", avgAmount: "0", p80Amount: "0" },
    },
    ...overrides,
  };
}
