export const detailsTabCopy = {
  loadMoreFailed: "加载更多失败，重试",
  noMore: "没有更多了",
  batchUpdated: (v: { count: string | number }) => `已更新 ${v.count} 项明细`,
  batchDeleted: (v: { count: string | number }) => `已删除 ${v.count} 项明细`,
  deleteSelectedTitle: "删除所选明细",
  deleteSelectedDescription: (v: { count: string | number }) =>
    `将删除 ${v.count} 项明细，无法撤销。`,
};

export const batchActionsCopy = {
  select: "选择",
  cancelSelect: "取消",
  actionsLabel: "批量操作",
  deselectAll: "取消全选",
  selectDay: (v: { date: string | number }) => `选中${v.date}的全部项目`,
  deselectDay: (v: { date: string | number }) => `取消选中${v.date}的全部项目`,
  manualCategory: "设置分类",
  manualCategoryShort: "分类",
  categoryPickDescription: (v: { count: string | number }) =>
    `已选 ${v.count} 条。选一个分类直接设置，选多个由 AI 逐条判断。`,
  categorySelectionRequired: "请选择一个或多个分类",
  categoryPickAssign: (v: { count: string | number; name: string | number }) =>
    `将 ${v.count} 条明细指定为「${v.name}」`,
  categoryPickClear: (v: { count: string | number }) => `将清空 ${v.count} 条明细的分类`,
  categoryPickAi: (v: { entryCount: string | number; categoryCount: string | number }) =>
    `AI 将把 ${v.entryCount} 条明细归入这 ${v.categoryCount} 个分类。`,
  aiCategoryRunning: "正在归类，完成后会通知你",
  aiCategoryDone: (v: {
    applied: string | number;
    confirmed: string | number;
    issues: string | number;
  }) => `已更新 ${v.applied} 条，${v.confirmed} 条无需改动，${v.issues} 条待检查`,
  aiCategoryFailed: "归类未完成，请重试。",
  aiCategoryBusy: "已有归类任务在进行。",
  uncategorized: "未分类",
  setCurrency: "修改货币",
  setCurrencyShort: "货币",
  loadedScope: "仅限已加载的所选项。",
  setDate: "修改日期",
  setDateShort: "日期",
  split: "拆分",
  datesUpdated: (v: { count: string | number }) => `已更新 ${v.count} 项的日期`,
  confirm: "确认",
  retry: "重试",
  delete: "删除",
  dateImpactTitle: "修改所选项目的日期？",
  dateImpactDescription: (v: {
    documents: string | number;
    entries: string | number;
    scope: string | number;
  }) => `将影响 ${v.documents} 张账单和 ${v.entries} 条明细。${v.scope}`,
  dateImpactFailed: "无法预估影响范围，请重试。",
  retryImpact: "重试预览",
  deleted: (v: { count: string | number }) => `已删除 ${v.count} 张账单`,
  retried: (v: { count: string | number }) => `已重新处理 ${v.count} 张账单`,
  partialResult: (v: { succeeded: string | number; failed: string | number }) =>
    `成功 ${v.succeeded} 项，失败 ${v.failed} 项`,
  deleteTitleDocuments: "删除所选账单",
  deleteDescriptionDocuments: (v: { count: string | number; scope: string | number }) =>
    `将删除 ${v.count} 张账单及其明细，无法撤销。${v.scope}`,
  selectAll: "全选",
  selectAbnormal: (v: { count: string | number }) => `选中异常（${v.count}）`,
  selectAbnormalShort: "选中异常",
  selectedOfTotal: (v: { selected: string | number; total: string | number }) =>
    `已选 ${v.selected} / ${v.total}`,
  selectedOfLoaded: (v: { selected: string | number; loaded: string | number }) =>
    `已选 ${v.selected} / 已加载 ${v.loaded}`,
  batchLimit: (v: { actions: string | number }) => `${v.actions}每次最多处理 100 条。`,
  categoryBatchUnlimited: "分类可处理当前全部选择。",
  batchLimitDate: "日期",
  batchLimitCurrency: "币种",
  batchLimitDelete: "删除",
  categoryAssignConfirm: (v: { name: string | number }) => `设为「${v.name}」`,
  categoryAiConfirm: (v: { count: string | number }) => `AI 分类 ${v.count} 条明细`,
  categoryClearConfirm: (v: { count: string | number }) => `清空 ${v.count} 条分类`,
  categorySelectAllCandidates: "选择全部分类",
  categoryClearCandidates: "清除候选选择",
  categoryClearChoice: "清空分类",
  categoryAiStrictDescription: "结合明细和原图判断；成功的先保存，失败的可重试。",
  categorySelectionTooLarge: (v: { max: string | number }) =>
    `一次最多归类 ${v.max} 条，请缩小选择范围。`,
  categoryJobPending: "已创建，等待处理",
  categoryJobProgress: (v: {
    processed: string | number;
    total: string | number;
    active: string | number;
  }) => `已处理 ${v.processed}/${v.total}；正在处理 ${v.active} 张账单`,
  categoryJobRetrying: (v: { count: string | number; seconds: string | number }) =>
    `${v.count} 张账单将在 ${v.seconds} 秒后重试`,
  categoryJobReadFailed: "暂时无法获取进度，任务可能仍在进行",
  categoryJobSucceeded: (v: { applied: string | number; confirmed: string | number }) =>
    `已更新 ${v.applied} 条，${v.confirmed} 条无需改动`,
  categoryJobPartial: "已完成部分分类，仍有失败或冲突",
  categoryJobFailed: "分类失败，已保存本次选择",
  categoryJobCancelled: "已停止；已完成结果保留",
  categoryJobStopFailed: "未能停止分类任务，请重试。",
  categoryJobRetryFailed: "未能重新开始分类，请重试。",
  categoryRetryFailed: "重试失败部分",
  categoryRetryLatest: "按最新内容重新分类",
  categoryStopDescription: "停止后，已完成的分类会保留。",
  categoryEntryPending: "分类中",
  categoryEntryFailed: "分类失败",
  categoryEvidenceIncomplete: "部分原图无法读取，已用其余资料",
  categoryRefreshStatus: "刷新状态",
  categoryViewResults: "查看结果",
  categoryStop: "停止",
  categoryAssignmentClose: "隐藏",
  categoryResultsTitle: "分类结果",
  categoryEntryDeleted: "明细已删除",
  categoryOutcomeApplied: "已更新",
  categoryOutcomeConfirmed: "已符合",
  categoryOutcomeFailed: "失败",
  categoryOutcomeConflict: "发生修改",
  categoryOutcomeSkipped: "已跳过",
  categoryOutcomeCancelled: "已停止",
  categoryErrorAiTimeout: "AI 请求超时",
  categoryErrorAiRateLimited: "AI 服务暂时限流",
  categoryErrorAiUnavailable: "AI 服务暂时不可用",
  categoryErrorAiConfiguration: "AI 配置无效",
  categoryErrorAiSchema: "AI 返回结果不完整",
  categoryErrorStorage: "原图存储暂时不可用",
  categoryErrorDocumentChanged: "原账单已被修改",
  categoryErrorDocumentUnavailable: "原账单或明细已不可用",
  categoryErrorCategoryChanged: "候选分类已变化",
  categoryErrorUploadExpired: "选择上传已过期",
  categoryErrorUpgradeInterrupted: "任务因系统升级中断",
  categoryErrorUnknown: "任务未完成",
};

export const entryFilterPanelCopy = {
  filter: "筛选",
  activeFilterCount: (v: { count: string | number }) => `已启用 ${v.count} 个筛选`,
  category: "类别",
  currency: "货币",
  minAmount: "最小金额",
  maxAmount: "最大金额",
  allCategories: "全部类别",
  allCurrencies: "全部货币",
  reset: "清除全部",
  clearFilters: "清除筛选",
  apply: "应用筛选",
  status: "状态",
  statusProcessing: "处理中",
  statusCompleted: "已完成",
  statusFailed: "失败",
  statusCancelled: "已取消",
  searchPlaceholder: "搜索标题、名称或描述",
  noMatchingResults: "没有符合条件的结果",
};

export const ledgerEntriesTabCopy = {
  loadMoreFailed: "加载更多失败，重试",
  noMore: "没有更多了",
  deleteConfirmTitle: "确认删除",
  deleteConfirmDesc: "将删除这张账单及其明细，无法撤销。",
  loadingMore: "加载更多…",
};
