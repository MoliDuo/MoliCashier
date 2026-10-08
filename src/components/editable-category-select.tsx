"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, CircleSlash } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface EditableCategoryOption {
  id: string;
  name: string;
  icon: string | null;
}

interface EditableCategorySelectProps {
  value: string | null;
  categories: EditableCategoryOption[];
  onChange: (categoryId: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  /**
   * Render just the category icon as the trigger. Use this where the category
   * name is already shown next to the control, so the pill's icon+name would
   * repeat it.
   */
  iconOnly?: boolean;
}

export function EditableCategorySelect({
  value,
  categories,
  onChange,
  placeholder,
  className,
  disabled = false,
  iconOnly = false,
}: EditableCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const selectedCategory = categories.find((category) => category.id === value);

  const handleSelect = (categoryId: string) => {
    onChange(categoryId);
    setOpen(false);
  };

  if (disabled) {
    if (iconOnly) {
      return (
        <span
          className={cn(
            "inline-flex min-h-11 w-8 max-md:w-11 shrink-0 items-center justify-center",
            className
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface2 text-text">
            {selectedCategory ? (
              <CategoryIcon iconName={selectedCategory.icon} className="h-4 w-4" />
            ) : (
              <CircleSlash aria-hidden="true" className="h-4 w-4 opacity-60" />
            )}
          </span>
        </span>
      );
    }
    return (
      <span
        className={cn(
          textRoleClassName("body", "inline-flex min-h-11 items-center gap-1 rounded px-3 py-1"),
          "bg-primary/10 text-primary",
          className
        )}
      >
        {selectedCategory ? (
          <>
            <CategoryIcon iconName={selectedCategory.icon} className="h-3.5 w-3.5" />
            <span className="font-medium">{selectedCategory.name}</span>
          </>
        ) : (
          <span>{placeholder}</span>
        )}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-label={iconOnly ? (selectedCategory?.name ?? placeholder) : undefined}
          className={cn(
            textRoleClassName("body", "inline-flex min-h-11 items-center gap-1 rounded px-3 py-1"),
            "cursor-pointer transition-colors",
            iconOnly
              ? "w-8 max-md:w-11 shrink-0 justify-center gap-0 px-0"
              : "border border-transparent hover:bg-surface2 hover:border-border/50",
            !iconOnly &&
              (selectedCategory ? "bg-primary/10 text-primary" : "text-muted-foreground"),
            className
          )}
        >
          {iconOnly ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface2 text-text transition-colors hover:bg-surface2/80">
              {selectedCategory ? (
                <CategoryIcon iconName={selectedCategory.icon} className="h-4 w-4" />
              ) : (
                <CircleSlash aria-hidden="true" className="h-4 w-4 opacity-60" />
              )}
            </span>
          ) : selectedCategory ? (
            <>
              <CategoryIcon iconName={selectedCategory.icon} className="h-3.5 w-3.5" />
              <span className="font-medium">{selectedCategory.name}</span>
            </>
          ) : (
            <span>{placeholder}</span>
          )}
          {!iconOnly && <ChevronDown aria-hidden="true" className="h-3 w-3 opacity-50 ml-0.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-1" align="start" sideOffset={4}>
        <div
          id={listboxId}
          role="listbox"
          aria-label={placeholder}
          className="max-h-[250px] overflow-y-auto subtle-scrollbar"
        >
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={value === category.id}
              onClick={() => handleSelect(category.id)}
              className={cn(
                textRoleClassName(
                  "body",
                  "flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                ),
                value === category.id ? "bg-accent text-accent-foreground" : "text-text"
              )}
            >
              <CategoryIcon iconName={category.icon} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              {value === category.id && <Check aria-hidden="true" className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
