"use client";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive technology. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** A row of mutually exclusive choices, each a pressed-state button. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex gap-1 rounded-lg bg-surface2 p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-9 max-md:min-h-11 flex-1 rounded-md px-2 text-sm font-medium transition-colors duration-[var(--motion-feedback)] disabled:opacity-50",
              active ? "bg-surface text-primary shadow-sm" : "text-muted-foreground hover:text-text"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
