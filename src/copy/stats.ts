export const statsTabCopy = {
  expenseTrend: "支出趋势",
  cumulativeExpense: "累计支出",
  expenseRanking: "支出排行",
  dailyHeatmap: "每日热力图",
  chartViews: "图表视图",
  daily: "每日",
  cumulative: "累计",
  heatmap: "日历",
  averageDaily: "日均支出",
  totalExpense: "总支出",
  noStats: "暂无统计",
  noStatsDesc: "记录几笔账后，这里会显示钱花在哪里。",
  uncategorized: "未分类",
  lastWeek: "上周",
  lastMonth: "上月",
  lastYear: "去年",
  previousSpan: "前一段时间",
  samePeriodMore: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}同期多 ${v.amount}（+${v.percent}%）`,
  samePeriodLess: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}同期少 ${v.amount}（-${v.percent}%）`,
  samePeriodEqual: (v: { period: string | number }) => `与${v.period}同期持平`,
  fullPeriodMore: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}多 ${v.amount}（+${v.percent}%）`,
  fullPeriodLess: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `较${v.period}少 ${v.amount}（-${v.percent}%）`,
  fullPeriodEqual: (v: { period: string | number }) => `与${v.period}持平`,
  loadFailed: "统计数据加载失败，请重试。",
  retry: "重试",
  entries: "笔数",
  typicalDaily: "典型日支出",
  typicalDailyHint: "每天支出的中位数，不受单笔大额影响",
  forecast: "预计本期",
  forecastHint: "已花 + 剩余天数 × 典型日支出",
  thisPeriod: "本期",
  previousSamePeriod: "上期同期",
  previousPeriod: "上期",
  forecastLine: "预计",
  forecastRange: (v: { low: string | number; high: string | number }) => `${v.low}–${v.high}`,
  changeMarker: "花钱的样子从这天起变了",
  forecastModelHint: (v: { low: string | number; high: string | number }) =>
    `八成可能落在 ${v.low}–${v.high}`,
  forecastEnd: (v: { amount: string | number }) => `预计 ${v.amount}`,
  previousEnd: (v: { period: string | number; amount: string | number }) =>
    `${v.period} ${v.amount}`,
  heatmapHint: "点日期查看当天的明细",
  dailyAverageLine: "日均",
  highlights: "本期看点",
  busiestDay: "最大单日",
  topMoverUp: (v: {
    category: string | number;
    period: string | number;
    amount: string | number;
  }) => `${v.category} 比${v.period}多花了 ${v.amount}`,
  topMoverDown: (v: {
    category: string | number;
    period: string | number;
    amount: string | number;
  }) => `${v.category} 比${v.period}少花了 ${v.amount}`,
  rankingMore: (v: { amount: string | number }) => `较上期 ↑${v.amount}`,
  rankingLess: (v: { amount: string | number }) => `较上期 ↓${v.amount}`,
  largestEntries: "最大几笔",
  showAllCategories: (v: { count: string | number }) => `显示全部（${v.count}）`,
  showFewerCategories: "收起",
  noShare: "无占比",
};

export const statsChartCopy = {
  scaleAdjusted: "已调整显示比例",
  expense: "支出",
  exceedsLimit: "（超出显示上限）",
  noData: "这个时间段暂无图表数据",
};

export const forecastCopy = {
  title: "分类预测",
  spent: (v: { amount: string | number }) => `已花 ${v.amount}`,
  expected: (v: { amount: string | number }) => `预计 ${v.amount}`,
  range: (v: { low: string | number; high: string | number }) => `八成在 ${v.low}–${v.high}`,
  exceedPrevious: (v: {
    period: string | number;
    amount: string | number;
    percent: string | number;
  }) => `超过${v.period}（${v.amount}）的可能约 ${v.percent}%`,
  lifeChange: (v: { date: string | number; before: string | number; after: string | number }) =>
    `${v.date}起花钱的样子变了（日均 ${v.before} → ${v.after}），之前的日子只作参考。`,
  basis: (v: { halfLife: string | number }) =>
    `按每个分类过去的花钱节奏模拟剩下的日子；${v.halfLife} 天前的一天只算昨天的一半。`,
  basisEven: "按每个分类过去的花钱节奏模拟剩下的日子，每一天都算得一样重。",
  accuracy: (v: { origins: string | number; days: string | number; error: string | number }) =>
    `回到过去 ${v.origins} 个日子各试一次：预测之后 ${v.days} 天花多少，平均差约 ±${v.error}%。`,
  networkShare: (v: { percent: string | number }) => `其中神经网络占 ${v.percent}%。`,
  networkBench: "神经网络还没赢过统计模型，暂时只在后台比赛。",
  upcomingTitle: "接下来大概会有",
  upcomingItem: (v: { date: string | number; label: string | number; amount: string | number }) =>
    `${v.date} ${v.label} 约 ${v.amount}`,
  weeklyStreak: (v: { count: string | number }) => `每周 · 已连续 ${v.count} 次`,
  biweeklyStreak: (v: { count: string | number }) => `每两周 · 已连续 ${v.count} 次`,
  monthlyStreak: (v: { count: string | number }) => `每月 · 已连续 ${v.count} 次`,
  whatIfTitle: "如果剩下的日子……",
  whatIfCategory: (v: { category: string | number; percent: string | number }) =>
    `${v.category} ${v.percent}`,
  whatIfUnchanged: "不变",
  whatIfMore: (v: { percent: string | number }) => `多 ${v.percent}%`,
  whatIfLess: (v: { percent: string | number }) => `少 ${v.percent}%`,
  whatIfOutcome: (v: { amount: string | number; low: string | number; high: string | number }) =>
    `本期预计 ${v.amount}，八成在 ${v.low}–${v.high}`,
  whatIfExceed: (v: { period: string | number; percent: string | number }) =>
    `超过${v.period}的可能约 ${v.percent}%`,
  whatIfReset: "还原",
  commentary: "让 AI 说说",
  commentaryLoading: "AI 正在看……",
  commentaryFailed: "AI 暂时没能回答，请稍后再试。",
  commentaryHint: "只把上面这些汇总数字交给 AI，不含任何明细。",
  anomaly: (v: {
    date: string | number;
    category: string | number;
    amount: string | number;
    typical: string | number;
  }) => `${v.date} ${v.category} ${v.amount}，平时一天约 ${v.typical}`,
  anomalies: "不寻常的日子",
};
