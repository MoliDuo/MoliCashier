import { randomUUID } from "node:crypto";

export function createLedgerData(
  overrides: Partial<{
    id: string;
    aiLanguage: string;
    preferredCurrencies: string[];
    mainCurrency: string;
    collapseEntriesDefault: boolean;
    aiCustomPrompt: string;
    aiLearnedPreferences: string;
    aiPreferenceLearningEnabled: boolean;
    timeZone: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: randomUUID(),
    aiLanguage: "zh-CN",
    preferredCurrencies: [],
    mainCurrency: "CNY",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
    aiLearnedPreferences: "",
    aiPreferenceLearningEnabled: true,
    timeZone: "Asia/Shanghai",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createCategoryData(
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: randomUUID(),
    name: "餐饮",
    description: "外卖、堂食、食材采购",
    icon: "🍽️",
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createLedgerEntryData(
  overrides: Partial<{
    id: string;
    categoryId: string | null;
    sourceDocumentId: string;
    amount: string;
    currency: string;
    itemName: string;
    description: string | null;
    entryDate: string | null; // yyyy-MM-dd format
    createdAt: Date;
  }> = {}
) {
  // sourceDocumentId is required by schema, so generate one if not provided
  const sourceDocumentId = overrides.sourceDocumentId ?? randomUUID();

  return {
    id: randomUUID(),
    categoryId: null,
    sourceDocumentId,
    amount: "25.50",
    currency: "CNY",
    itemName: "午餐",
    description: null,
    entryDate: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function createSourceDocumentData(
  overrides: Partial<{
    id: string;
    title: string | null;
    text: string | null;
    imageUrls: string[];
    metadata: Record<string, unknown>;
    status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
    documentDate: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  const now = new Date();
  const {
    text: _text,
    imageUrls: _imageUrls,
    metadata: _metadata,
    status: _status,
    ...canonicalOverrides
  } = overrides;
  return {
    id: randomUUID(),
    title: null,
    // Unless a test dates it, a record counts on the day it was created.
    documentDate: (overrides.createdAt ?? now).toISOString().slice(0, 10),
    createdAt: now,
    updatedAt: now,
    ...canonicalOverrides,
  };
}
