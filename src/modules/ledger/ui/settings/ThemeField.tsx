"use client";

import { useTheme } from "next-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsField } from "@/components/SettingsField";
import { settingsCopy } from "@/copy/settings";

const THEME_LABELS = {
  system: settingsCopy.themeAuto,
  light: settingsCopy.themeLight,
  dark: settingsCopy.themeDark,
} as const;

/**
 * The theme is remembered by this browser, not the ledger, so it applies at
 * once and never waits on a ledger save.
 */
export function ThemeField() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsField title={settingsCopy.theme}>
      <Select value={theme ?? "system"} onValueChange={setTheme}>
        <SelectTrigger aria-label={settingsCopy.theme} className="w-full max-md:h-11 sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["system", "light", "dark"] as const).map((themeName) => (
            <SelectItem key={themeName} value={themeName}>
              {THEME_LABELS[themeName]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsField>
  );
}
