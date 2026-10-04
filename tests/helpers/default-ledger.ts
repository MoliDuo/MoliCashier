import { DEFAULT_CATEGORIES } from "@/config/default-categories";

/**
 * The settings and categories a new ledger starts with, in the seeding shape
 * `createDefault` expects. Rows are 0-based, as `saveEntryCategories` writes.
 */
const defaultLedger = {
  settings: {
    aiLanguage: "zh-CN",
    currencies: ["CNY", "USD"] as string[],
    mainCurrency: "CNY",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
    aiLearnedPreferences: "",
    aiLearnedPreferencesUpdatedAt: null,
    aiPreferenceLearningEnabled: true,
    timeZone: "Asia/Shanghai",
  },
  categories: DEFAULT_CATEGORIES.map(({ name, description, icon }, sortOrder) => ({
    name,
    description,
    icon,
    sortOrder,
  })),
};

export function getDefaultLedger() {
  return defaultLedger;
}
