"use client";
import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";

interface EditableFieldProps {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "textarea";
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  displayClassName?: string;
  renderDisplay?: (value: string) => ReactNode;
  disabled?: boolean;
  /** If true, save on blur. If false, show confirm/cancel buttons */
  saveOnBlur?: boolean;
  /** Accessible label for the confirm button (required when saveOnBlur is false) */
  confirmLabel?: string;
  /** Accessible label for the cancel button (required when saveOnBlur is false) */
  cancelLabel?: string;
  /** Minimum rows for textarea */
  minRows?: number;
  /** Maximum rows for textarea before scrolling */
  maxRows?: number;
  /** Names the input while editing; the display names itself by its text. */
  inputAriaLabel?: string;
}

export function EditableField({
  value,
  onChange,
  type = "text",
  placeholder = "",
  className,
  inputClassName,
  displayClassName,
  renderDisplay,
  disabled = false,
  saveOnBlur = true,
  confirmLabel,
  cancelLabel,
  minRows = 1,
  maxRows = 10,
  inputAriaLabel,
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const autoResizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || type !== "textarea") return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = "auto";

    // Calculate line height (approximate if not available)
    const parsedLineHeight = parseInt(getComputedStyle(textarea).lineHeight);
    const lineHeight = Number.isNaN(parsedLineHeight) ? 20 : parsedLineHeight;
    const minHeight = lineHeight * minRows;
    const maxHeight = lineHeight * maxRows;

    // Set new height based on content, clamped to min/max
    const newHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
    textarea.style.height = `${newHeight}px`;
  }, [type, minRows, maxRows]);

  // Focus input and auto-resize textarea when entering edit mode
  useEffect(() => {
    if (isEditing && type === "textarea") {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        requestAnimationFrame(autoResizeTextarea);
      }
    } else if (isEditing && type !== "textarea") {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [isEditing, type, autoResizeTextarea]);

  // Auto-resize when value changes during editing
  useEffect(() => {
    if (isEditing && type === "textarea") {
      autoResizeTextarea();
    }
  }, [localValue, isEditing, type, autoResizeTextarea]);

  const handleConfirm = () => {
    onChange(localValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLocalValue(value);
    setIsEditing(false);
  };

  const handleStartEditing = () => {
    setLocalValue(value);
    setIsEditing(true);
  };

  const handleBlur = () => {
    if (saveOnBlur) {
      handleConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (type === "textarea" && !(e.metaKey || e.ctrlKey)) {
        return;
      }
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
  };

  // Shared container styles for both modes to prevent layout shift
  const containerStyles = cn(
    "relative inline-flex items-center w-full",
    "rounded px-0.5 py-0 -mx-0.5 -my-0",
    "transition-[color,background-color,border-color,opacity] duration-[var(--motion-feedback)] ease-[var(--motion-enter)]",
    className
  );

  // Interactive styles only applied when not disabled and not editing
  const interactiveStyles =
    !disabled && !isEditing
      ? "cursor-pointer hover:bg-surface2 border border-transparent hover:border-border/50"
      : "";

  if (disabled) {
    return (
      <div className={cn(containerStyles, displayClassName)}>
        {renderDisplay != null ? renderDisplay(value) : value !== "" ? value : placeholder}
      </div>
    );
  }

  if (isEditing) {
    const isTextarea = type === "textarea";

    return (
      <div
        className={cn(containerStyles, "bg-surface2/50 border-border/50", displayClassName)}
        // Esc cancels this edit; the dialog around it stays open.
        data-escape-cancels=""
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0 relative">
          {isTextarea ? (
            <Textarea
              ref={textareaRef}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label={inputAriaLabel}
              rows={minRows}
              className={cn(
                // Remove default styling that causes shifts
                "border-0 bg-transparent shadow-none",
                "p-0 m-0 w-full",
                // Inherit typography from display mode
                "text-inherit font-inherit leading-inherit",
                // Textarea specific
                "resize-none overflow-hidden min-h-0",
                inputClassName,
                // Desktop matches the text it replaces; phones stay at 16px so
                // iOS Safari does not zoom in when the field takes focus.
                "max-md:text-base md:text-[length:inherit]"
              )}
              style={{
                lineHeight: "inherit",
                fontWeight: "inherit",
              }}
            />
          ) : (
            <Input
              ref={inputRef}
              type={type === "number" ? "number" : "text"}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-label={inputAriaLabel}
              className={cn(
                // Remove default styling that causes shifts
                "border-0 bg-transparent shadow-none",
                "p-0 m-0 w-full",
                // Inherit typography from display mode
                "text-inherit font-inherit leading-inherit",
                // Compact height for non-textarea inputs
                "h-auto px-1",
                inputClassName,
                // Desktop matches the text it replaces; phones stay at 16px so
                // iOS Safari does not zoom in when the field takes focus.
                "max-md:text-base md:text-[length:inherit]"
              )}
              style={{
                lineHeight: "inherit",
                fontWeight: "inherit",
              }}
            />
          )}
        </div>
        {!saveOnBlur && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <button
              type="button"
              onClick={handleConfirm}
              aria-label={confirmLabel}
              className="p-1 rounded hover:bg-primary/10 text-primary"
            >
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCancel}
              aria-label={cancelLabel}
              className="p-1 rounded hover:bg-destructive/10 text-muted-foreground"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={handleStartEditing}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          handleStartEditing();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(containerStyles, interactiveStyles, displayClassName)}
    >
      {renderDisplay ? (
        renderDisplay(value)
      ) : (
        <span className={cn(value === "" && "text-muted-foreground/60", "truncate")}>
          {value !== "" ? value : placeholder}
        </span>
      )}
    </div>
  );
}
