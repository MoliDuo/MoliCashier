"use client";
import { textRoleClassName } from "@/components/typography";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import type { Settings } from "@/modules/ledger/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsCopy } from "@/copy/settings";

interface CurrencySectionProps {
  settings: Pick<Settings, "currencies" | "mainCurrency">;
  onUpdateSettings: (data: Partial<Settings>) => void;
  disabled?: boolean;
}

function PreferredCurrenciesMenu({
  initialCurrencies,
  mainCurrency,
  onUpdateSettings,
  disabled = false,
}: {
  initialCurrencies: string[];
  mainCurrency: string;
  onUpdateSettings: CurrencySectionProps["onUpdateSettings"];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filteredCurrencies = SUPPORTED_CURRENCIES.filter((currency) =>
    currency.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggleCurrency = (currency: string) => {
    if (currency === mainCurrency) return;
    const newCurrencies = initialCurrencies.includes(currency)
      ? initialCurrencies.filter((current) => current !== currency)
      : [...initialCurrencies, currency];
    onUpdateSettings({ currencies: newCurrencies });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-between font-normal max-md:h-11 sm:w-64"
          aria-label={settingsCopy.preferredCurrencies}
          disabled={disabled}
        >
          <span className="truncate">
            {initialCurrencies.length === 0
              ? settingsCopy.preferredCurrenciesNone
              : settingsCopy.preferredCurrenciesSummary({
                  currencies: initialCurrencies.slice(0, 3).join(", "),
                  count: initialCurrencies.length,
                })}
          </span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-2">
        <div className="relative mb-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            name="currencySearch"
            autoComplete="off"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={settingsCopy.preferredCurrenciesSearch}
            aria-label={settingsCopy.preferredCurrenciesSearch}
            className="h-10 pl-9"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filteredCurrencies.map((currency) => {
            const isMainCurrency = currency === mainCurrency;
            const isSelected = isMainCurrency || initialCurrencies.includes(currency);
            return (
              <label
                key={currency}
                className={textRoleClassName(
                  "body",
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-surface2"
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleCurrency(currency)}
                  disabled={disabled || isMainCurrency}
                />
                <span>{currency}</span>
                {isMainCurrency ? (
                  <span className={textRoleClassName("meta", "ml-auto")}>
                    {settingsCopy.mainCurrencyMustBeEnabled}
                  </span>
                ) : null}
              </label>
            );
          })}
          {filteredCurrencies.length === 0 ? (
            <p className={textRoleClassName("bodyMuted", "px-2 py-6 text-center")}>
              {settingsCopy.preferredCurrenciesNoResults}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CurrencySection({
  settings,
  onUpdateSettings,
  disabled = false,
}: CurrencySectionProps) {
  const settingsCurrencies = settings.currencies;
  const mainCurrency = settings.mainCurrency;

  const updateMainCurrency = (currency: string) => {
    if (currency === mainCurrency) return;
    onUpdateSettings({
      mainCurrency: currency,
      currencies: settingsCurrencies.includes(currency)
        ? settingsCurrencies
        : [...settingsCurrencies, currency],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className={textRoleClassName("bodyStrong")}>{settingsCopy.mainCurrency}</h3>
        </div>
        <Select value={mainCurrency} onValueChange={updateMainCurrency} disabled={disabled}>
          <SelectTrigger
            aria-label={settingsCopy.mainCurrency}
            className="w-full max-md:h-11 sm:w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {SUPPORTED_CURRENCIES.map((currency) => (
              <SelectItem key={currency} value={currency}>
                {currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className={textRoleClassName("bodyStrong")}>{settingsCopy.preferredCurrencies}</h3>
        </div>
        <PreferredCurrenciesMenu
          initialCurrencies={
            settingsCurrencies.includes(mainCurrency)
              ? settingsCurrencies
              : [mainCurrency, ...settingsCurrencies]
          }
          mainCurrency={mainCurrency}
          onUpdateSettings={onUpdateSettings}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
