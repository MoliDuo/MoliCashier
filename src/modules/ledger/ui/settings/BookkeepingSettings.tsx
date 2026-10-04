"use client";

import type {
  EntryCategory,
  EntryCategoryWithCount,
  Ledger,
  SaveEntryCategoriesInput,
  Settings,
} from "@/modules/ledger/contracts";
import { CurrencySection } from "../CurrencySection";
import { CategorySection } from "../CategorySection";
import { SettingsField } from "@/components/SettingsField";
import { ThemeField } from "./ThemeField";
import { SettingsSection } from "@/components/SettingsSection";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AI_LANGUAGES } from "@/config/languages";
import { LEDGER_TIME_ZONES } from "@/config/time-zones";
import { useEffect, useRef, useState } from "react";
import { settingsCopy } from "@/copy/settings";

interface BookkeepingSettingsProps {
  settings: Settings;
  categories: EntryCategoryWithCount[];
  uncategorizedCount: number;
  onUpdateSettings: (data: Partial<Settings>) => Promise<Ledger>;
  onSaveCategories: (input: SaveEntryCategoriesInput) => Promise<EntryCategory[]>;
  onReloadCategories?: () => Promise<EntryCategory[]>;
  generatingCategoryIds: Set<string>;
  failedCategoryIds: Set<string>;
  onRetryMetadata: (id: string) => void;
  isSavingCategories: boolean;
}

export function BookkeepingSettings({
  settings,
  categories,
  uncategorizedCount,
  onUpdateSettings,
  onSaveCategories,
  onReloadCategories,
  generatingCategoryIds,
  failedCategoryIds,
  onRetryMetadata,
  isSavingCategories,
}: BookkeepingSettingsProps) {
  // Every change is saved as it is made. The field shows the value on its way
  // to the server until the answer lands, and the fields stay disabled while it
  // is in flight so each save is made against the version the last one wrote.
  const [pending, setPending] = useState<Partial<Settings> | null>(null);
  const shown = { ...settings, ...pending };
  const saving = pending != null;

  const save = async (patch: Partial<Settings>) => {
    if (saving) return;
    setPending(patch);
    try {
      await onUpdateSettings(patch);
    } catch {
      // The mutation already reported the failure; the field falls back to
      // the saved value.
    } finally {
      setPending(null);
    }
  };

  // The prompt is text, so it saves when the reader leaves the field rather
  // than on every keystroke, and on the way out if the tab closes mid-edit.
  const [prompt, setPrompt] = useState<string | null>(null);
  const flushPrompt = useRef<() => void>(() => {});
  flushPrompt.current = () => {
    if (prompt == null) return;
    setPrompt(null);
    if (prompt !== settings.aiCustomPrompt) void save({ aiCustomPrompt: prompt });
  };
  useEffect(() => () => flushPrompt.current(), []);

  const timeZones = (LEDGER_TIME_ZONES as readonly string[]).includes(shown.timeZone)
    ? LEDGER_TIME_ZONES
    : [shown.timeZone, ...LEDGER_TIME_ZONES];

  return (
    <>
      {/*
        The page runs from the short, set-once preferences to the lists that
        grow: 外观 first, then 时区与货币 and AI 解析, then 分类. The ledger's
        fields share one save, so a field in one card waits for a save made in
        another; 主题 belongs to this browser and never waits.
      */}
      <SettingsSection>
        <ThemeField />
        <SettingsField title={settingsCopy.collapseEntries}>
          <Switch
            aria-label={settingsCopy.collapseEntries}
            checked={shown.collapseEntriesDefault}
            onCheckedChange={(checked) => void save({ collapseEntriesDefault: checked })}
            disabled={saving}
          />
        </SettingsField>
      </SettingsSection>
      <SettingsSection>
        <SettingsField title={settingsCopy.timeZone} description={settingsCopy.timeZoneDesc}>
          <Select
            value={shown.timeZone}
            onValueChange={(value) => void save({ timeZone: value })}
            disabled={saving}
          >
            <SelectTrigger aria-label={settingsCopy.timeZone} className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {timeZones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
        <CurrencySection
          settings={shown}
          onUpdateSettings={(patch) => void save(patch)}
          disabled={saving}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsField title={settingsCopy.aiLanguage}>
          <Select
            value={shown.aiLanguage}
            onValueChange={(value) => void save({ aiLanguage: value })}
            disabled={saving}
          >
            <SelectTrigger aria-label={settingsCopy.aiLanguage} className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {AI_LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsField>
        <SettingsField title={settingsCopy.aiPrompt} stacked>
          <Textarea
            value={prompt ?? shown.aiCustomPrompt}
            name="aiCustomPrompt"
            autoComplete="off"
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => flushPrompt.current()}
            readOnly={saving}
            aria-label={settingsCopy.aiPrompt}
            maxLength={4000}
            className="min-h-[100px] w-full resize-y"
          />
        </SettingsField>
      </SettingsSection>
      {/* 分类 saves through a draft of its own — 管理分类 holds the edit session
          and its 保存 — so it is a card of its own, next to the prompt that
          steers how entries land in it. */}
      <CategorySection
        categories={categories}
        uncategorizedCount={uncategorizedCount}
        onSaveCategories={onSaveCategories}
        {...(onReloadCategories == null ? {} : { onReloadCategories })}
        generatingCategoryIds={generatingCategoryIds}
        failedCategoryIds={failedCategoryIds}
        onRetryMetadata={onRetryMetadata}
        isSaving={isSavingCategories}
      />
    </>
  );
}

export type { BookkeepingSettingsProps };
