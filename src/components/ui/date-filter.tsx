"use client";
import * as React from "react";
import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import {
  formatDateTimeForApi,
  formatRelativeDateLabel,
  getDateInTimezone,
  isValidDateString,
  parseDateString,
} from "@/lib/date-utils";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { useLedgerTimeZone } from "@/lib/ledger-time-zone";
import { dateFilterCopy } from "@/copy/controls";

interface DateFilterProps {
  /** Selected date */
  value?: Date | string | null;
  /** Callback when date changes */
  onChange: (date: Date | null) => void;
  className?: string;
  /** Placeholder text when no date selected */
  placeholder?: string;
  /** Size variant */
  size?: "sm" | "default";
  /** Show clear button when date is selected */
  showClear?: boolean;
  /**
   * Whether the calendar's shortcuts include 清除. Pass false where the field's
   * value can never be empty, so no visible control is a no-op; a field that
   * cannot show a clear button may still clear from the calendar.
   */
  showClearShortcut?: boolean;
  /** Whether to truncate overflow text with ellipsis */
  truncate?: boolean;
  disabled?: boolean;
  /**
   * Render the selected date as static text instead of an interactive picker.
   * Use this in read-only surfaces, where a disabled button would still paint
   * the dropdown chrome (calendar icon + chevron) without being usable.
   */
  readOnly?: boolean;
  /** Overrides the read-only date text classes where the date is a headline value. */
  readOnlyTextClassName?: string;
  /** Drops the calendar marker from the read-only text. */
  hideReadOnlyIcon?: boolean;
  minDate?: Date;
  maxDate?: Date;
  /**
   * Ledger timezone: 今天/昨天 must name the day the ledger is on, not the day
   * the device is on, or the same field reads differently in the two tabs.
   * Defaults to the zone the ledger layout provides.
   */
  timeZone?: string;
  /**
   * Accessible name for the trigger. A bare date field has no visible label, so
   * without this a screen reader announces only the value.
   */
  ariaLabel?: string;
}

export function DateFilter({
  value,
  onChange,
  className,
  placeholder,
  size = "default",
  showClear = true,
  showClearShortcut = true,
  truncate = true,
  disabled = false,
  readOnly = false,
  readOnlyTextClassName,
  hideReadOnlyIcon = false,
  minDate,
  maxDate,
  timeZone,
  ariaLabel,
}: DateFilterProps) {
  const locale = DISPLAY_LOCALE;
  const ledgerTimeZone = useLedgerTimeZone();
  const zone = timeZone ?? ledgerTimeZone;
  const [open, setOpen] = React.useState(false);

  const civilDateString = React.useMemo(() => {
    if (value == null) return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : formatDateTimeForApi(value);
    }
    return isValidDateString(value) ? value : null;
  }, [value]);

  // The field paints its value the way the rest of the app writes a day.
  const dateLabel =
    civilDateString == null ? null : formatRelativeDateLabel(civilDateString, locale, zone);

  const dateValue = React.useMemo(
    () => (civilDateString == null ? null : parseDateString(civilDateString)),
    [civilDateString]
  );

  const handleDateChange = (date: Date | null) => {
    onChange(date);
    if (date !== undefined) {
      setOpen(false);
    }
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  const isSmall = size === "sm";

  if (readOnly && civilDateString != null) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
        {!hideReadOnlyIcon && (
          <CalendarIcon
            aria-hidden="true"
            className={cn("shrink-0 text-muted-foreground", isSmall ? "h-3.5 w-3.5" : "h-4 w-4")}
          />
        )}
        <span className={textRoleClassName("body", cn("min-w-0", readOnlyTextClassName))}>
          {dateLabel}
        </span>
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative inline-flex", className)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            disabled={disabled}
            variant="outline"
            size={isSmall ? "sm" : "default"}
            {...(ariaLabel != null ? { "aria-label": ariaLabel } : {})}
            className={cn(
              "w-full justify-start text-left font-normal",
              isSmall ? "h-8 px-2" : "h-10 px-3",
              showClear && dateValue && !disabled && (isSmall ? "pr-8" : "pr-10"),
              !dateValue && "text-muted-foreground"
            )}
          >
            <CalendarIcon className={cn("mr-2 shrink-0", isSmall ? "h-3.5 w-3.5" : "h-4 w-4")} />
            <span className={cn(truncate ? "truncate" : "whitespace-nowrap", "flex-1")}>
              {dateLabel ?? placeholder ?? dateFilterCopy.selectDate}
            </span>
            <ChevronDown
              className={cn("ml-auto opacity-50 shrink-0", isSmall ? "h-3.5 w-3.5" : "h-4 w-4")}
            />
          </Button>
        </PopoverTrigger>
        {showClear && dateValue && !disabled ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label={dateFilterCopy.clear}
            className={cn(
              "absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-sm opacity-60 hover:bg-accent hover:opacity-100",
              isSmall ? "size-7" : "size-8"
            )}
          >
            <X className={isSmall ? "size-3" : "size-4"} />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-auto p-0" align="start" sideOffset={4}>
        <Calendar
          value={dateValue}
          onChange={handleDateChange}
          onEscape={() => setOpen(false)}
          // Read as the picker opens, so a page left open overnight offers the new day.
          today={getDateInTimezone(zone)}
          showShortcuts
          // Fields whose value can never be empty pass false, so the calendar
          // does not offer a 清除 that silently does nothing.
          showClearShortcut={showClearShortcut}
          {...(minDate === undefined ? {} : { minDate })}
          {...(maxDate === undefined ? {} : { maxDate })}
        />
      </PopoverContent>
    </Popover>
  );
}
