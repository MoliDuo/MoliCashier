/**
 * Lightweight skeleton components for tab content areas.
 * Used as Suspense fallbacks when tab data is loading.
 */

/**
 * Skeleton for the LedgerEntries (流水) tab.
 * Shows filter bar + entry card placeholders with date grouping.
 */
export function EntriesTabSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4 px-2" data-testid="entries-tab-skeleton">
      {/* Top toolbar skeleton - matches: select button + filter panel + total */}
      <div className="flex items-center gap-2 mb-2 sm:mb-4">
        {/* Select mode button */}
        <div className="h-8 w-8 bg-surface2 rounded-md animate-pulse shrink-0" />
        {/* Filter panel - "更多筛选" button */}
        <div className="h-8 w-28 bg-surface2 rounded-md animate-pulse" />
        {/* Spacer */}
        <div className="flex-1" />
        {/* Total amount text */}
        <div className="h-4 w-28 bg-surface2 rounded animate-pulse font-mono" />
      </div>

      {/* Date group skeletons */}
      {[1, 2, 3].map((dateGroupIndex) => (
        <div key={dateGroupIndex} className="space-y-2">
          {/* Date header - matches: dot indicator + date + daily total */}
          <div className="py-2 px-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Dot indicator */}
              <div className="w-1.5 h-1.5 rounded-full bg-surface2 animate-pulse" />
              {/* Date text */}
              <div className="h-3 w-24 bg-surface2 rounded animate-pulse" />
            </div>
            {/* Daily total */}
            <div className="h-3 w-20 bg-surface2 rounded animate-pulse font-mono" />
          </div>

          {/* Source document cards for this date */}
          {[1, 2].map((cardIndex) => (
            <div
              key={cardIndex}
              className="bg-surface rounded-xl border border-border overflow-hidden"
            >
              {/* Card header - matches: expand icon + date + title + amount + more button */}
              <div className="px-4 py-3 bg-surface2/50 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {/* Expand/collapse chevron */}
                  <div className="h-4 w-4 bg-border rounded animate-pulse shrink-0" />
                  {/* Date (e.g., "3月5日") */}
                  <div className="h-4 w-12 bg-border rounded animate-pulse shrink-0" />
                  {/* Title (e.g., "赫赫海鲜晚餐") */}
                  <div className="h-4 w-28 bg-border rounded animate-pulse" />
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {/* Amount */}
                  <div className="h-4 w-16 bg-border rounded animate-pulse font-mono" />
                  {/* More menu button */}
                  <div className="h-7 w-7 bg-border rounded animate-pulse" />
                </div>
              </div>

              {/* Card content - ledger entries */}
              <div className="p-3 space-y-3 bg-surface2/30">
                {[1, 2].map((entryIndex) => (
                  <div key={entryIndex} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-3">
                      {/* Category/merchant icon */}
                      <div className="h-8 w-8 rounded-full bg-border animate-pulse" />
                      <div className="space-y-1.5">
                        {/* Entry title */}
                        <div className="h-4 w-24 bg-border rounded animate-pulse" />
                        {/* Category/subtitle */}
                        <div className="h-3 w-16 bg-border rounded animate-pulse" />
                      </div>
                    </div>
                    {/* Entry amount */}
                    <div className="h-4 w-14 bg-border rounded animate-pulse font-mono" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* End of list indicator */}
      <div className="flex justify-center py-4">
        <div className="h-3 w-24 bg-surface2 rounded animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Skeleton for the Details tab.
 * Shows filter toolbar + date groups with entry cards.
 */
export function DetailsTabSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="details-tab-skeleton">
      {/* Filter toolbar - matches: select button + filter panel + total */}
      <div className="px-2 mb-2 sm:mb-4 flex items-center gap-2">
        {/* Select mode button */}
        <div className="h-8 w-8 bg-surface2 rounded-md animate-pulse shrink-0" />
        {/* Filter panel */}
        <div className="h-8 w-full sm:w-auto bg-surface2 rounded-md animate-pulse" />
        {/* Spacer */}
        <div className="flex-1 hidden sm:block" />
        {/* Total amount text */}
        <div className="h-4 w-28 bg-surface2 rounded animate-pulse font-mono ml-auto" />
      </div>

      {/* Date groups skeleton */}
      {[1, 2, 3].map((dateGroupIndex) => (
        <div key={dateGroupIndex} className="space-y-2">
          {/* Date header - matches: dot indicator + title + group total */}
          <div className="py-2 px-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Dot indicator */}
              <div className="w-1.5 h-1.5 rounded-full bg-surface2 animate-pulse" />
              {/* Date text */}
              <div className="h-3 w-24 bg-surface2 rounded animate-pulse" />
            </div>
            {/* Group total */}
            <div className="h-3 w-20 bg-surface2 rounded animate-pulse font-mono" />
          </div>

          {/* Entry cards for this group */}
          <div className="space-y-4 px-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-surface rounded-xl border border-border p-4 h-20 animate-pulse"
              />
            ))}
          </div>
        </div>
      ))}

      {/* Infinite scroll loading indicator */}
      <div className="flex justify-center py-4">
        <div className="h-4 w-20 bg-surface2 rounded animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Skeleton for the Stats tab.
 * Shows period selector + date navigator + total expense + heatmap + ranking.
 */
export function StatsTabSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6" data-testid="stats-tab-skeleton">
      {/* Stats Header Skeleton */}
      <div className="flex flex-col gap-6 bg-surface">
        {/* 1. Period selector (周/月/年) */}
        <div className="flex p-1 bg-surface2 rounded-lg self-center w-full max-w-xs">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex-1 h-8 bg-surface rounded-md animate-pulse mx-0.5" />
          ))}
        </div>

        {/* 2. Date navigator (arrow + label + arrow) */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-4">
            {/* Left arrow */}
            <div className="h-8 w-8 rounded-full bg-surface2 animate-pulse" />
            {/* Date label (e.g., "2026年3月") */}
            <div className="h-7 w-32 bg-surface2 rounded animate-pulse" />
            {/* Right arrow */}
            <div className="h-8 w-8 rounded-full bg-surface2 animate-pulse" />
          </div>
        </div>

        {/* 3. Summary stats */}
        <div className="flex flex-col items-center gap-2">
          {/* "总支出" label */}
          <div className="h-4 w-16 bg-surface2 rounded animate-pulse" />
          {/* Total amount */}
          <div className="flex items-center gap-2">
            <div className="h-6 w-12 bg-surface2 rounded animate-pulse" />
            <div className="h-10 w-32 bg-surface2 rounded animate-pulse" />
          </div>
          {/* Trend badge */}
          <div className="h-6 w-28 bg-surface2 rounded-full animate-pulse mt-1" />
          {/* Average daily */}
          <div className="h-3 w-24 bg-surface2 rounded animate-pulse mt-1" />
        </div>
      </div>

      {/* Chart section skeleton */}
      <div className="space-y-2">
        {/* Header with title + view toggle */}
        <div className="flex items-center justify-between px-2">
          <div className="h-5 w-20 bg-surface2 rounded animate-pulse" />
          <div className="flex items-center gap-1">
            {/* 每日, 累计 and 日历 */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-7 w-16 bg-surface2 rounded animate-pulse" />
            ))}
          </div>
        </div>

        {/* Heatmap grid skeleton - 3 rows of 7 days */}
        <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
          {/* Grid cells - simulating a calendar heatmap */}
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 21 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-surface2 animate-pulse" />
            ))}
          </div>
          {/* Legend */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <div className="h-3 w-8 bg-surface2 rounded animate-pulse" />
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-4 h-4 rounded-sm bg-surface2 animate-pulse" />
              ))}
            </div>
            <div className="h-3 w-8 bg-surface2 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Stats Ranking skeleton */}
      <div className="space-y-5 px-2">
        {/* "支出排行" title */}
        <div className="h-6 w-24 bg-surface2 rounded animate-pulse" />

        {/* Category items */}
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3">
            {/* Icon circle */}
            <div className="w-10 h-10 rounded-full bg-surface2 animate-pulse shrink-0" />
            {/* Content */}
            <div className="flex-1 space-y-2">
              {/* Top line: Name + Amount */}
              <div className="flex justify-between items-center">
                <div className="h-4 w-16 bg-surface2 rounded animate-pulse" />
                <div className="h-4 w-20 bg-surface2 rounded animate-pulse" />
              </div>
              {/* Bottom line: Progress bar + percent */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-surface2 rounded-full animate-pulse" />
                <div className="h-3 w-12 bg-surface2 rounded animate-pulse shrink-0" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for the Settings tab.
 * Shows the bordered, titled cards the page is made of.
 */
export function SettingsTabSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="settings-tab-skeleton">
      {[1, 2, 3, 4, 5].map((sectionIndex) => (
        <div
          key={sectionIndex}
          className="space-y-4 rounded-lg border border-border bg-surface p-4"
        >
          {/* Card title */}
          <div className="h-5 w-28 animate-pulse rounded bg-surface2" />

          {/* Card fields */}
          <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
            {[1, 2].map((itemIndex) => (
              <div
                key={itemIndex}
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Label and description */}
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-24 animate-pulse rounded bg-surface2" />
                  <div className="h-3 w-40 animate-pulse rounded bg-surface2/70" />
                </div>
                {/* Control (button, switch, or select) */}
                <div className="h-9 w-full shrink-0 animate-pulse rounded bg-surface2 sm:w-44" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
