export const metadataCopy = {
  title: "Moli Cashier",
  /** The installed app's name: home screen, task switcher. */
  appName: "Moli Cashier",
  manifestName: "Moli Cashier - AI 记账助手",
  description: "AI 驱动的智能记账工具",
};

export const notFoundCopy = {
  title: "页面未找到",
  description: "抱歉，您访问的页面不存在或已被移除。",
  backToHome: "返回主账本",
};

export const errorCopy = {
  title: "应用错误",
  description: "页面遇到意外错误，请重试。问题一直出现时，请记下下面的错误 ID。",
  errorId: (v: { id: string | number }) => `错误 ID：${v.id}`,
  goHome: "返回首页",
  retry: "重试",
};

export const routeErrorCopy = {
  title: "这个页面出错了",
  description: "可以重试，或者先切换到其他页面。",
};

export const ledgerQueryErrorCopy = {
  emptyDescription: "无法加载当前页面，请检查网络后重试。",
  description: "刷新失败，内容可能不是最新的。",
  retry: "重试",
};

export const ledgerPageCopy = {
  notFound: "账本不存在",
  settings: "设置",
  navigation: "账本导航",
  records: "账目",
  entries: "明细",
  filtered: "已筛选",
  totalPending: "—",
  stats: "统计",
  newRecord: "记账",
};
