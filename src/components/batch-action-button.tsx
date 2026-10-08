"use client";

import type { ComponentType, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { TOOLBAR_CONTROL_CLASS } from "@/components/toolbar-control";
import { cn } from "@/lib/utils";

export interface BatchActionButtonProps extends Omit<ButtonProps, "children"> {
  icon: ComponentType<{ className?: string }>;
  loading?: boolean;
  /**
   * Narrower label for the mobile row. Without one the button keeps a single
   * label at every width; with one, the wide label is what a screen reader
   * reads, so the short form has to be contained in it.
   */
  shortLabel?: string;
  /**
   * `stacked` is the phone's action bar: the icon over its label, filling an
   * equal share of the bar, at least a finger tall. It takes the short label.
   */
  orientation?: "row" | "stacked";
  children: ReactNode;
}

/**
 * Shared visual contract for batch actions across stream, details, and
 * source-document detail views.
 */
export function BatchActionButton({
  icon: Icon,
  loading = false,
  shortLabel,
  orientation = "row",
  children,
  className,
  disabled,
  variant,
  ...props
}: BatchActionButtonProps) {
  // Where only the short label shows, the button still names the whole action.
  const fullLabel =
    shortLabel != null && typeof children === "string" ? { "aria-label": children } : {};
  if (orientation === "stacked") {
    return (
      <Button
        variant="ghost"
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          "h-auto min-h-11 min-w-0 flex-1 flex-col gap-0.5 rounded-none px-1 py-2 text-micro font-medium [&_svg]:size-5",
          variant === "destructive" && "text-danger hover:text-danger",
          className
        )}
        {...fullLabel}
        {...props}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Icon aria-hidden="true" />
        )}
        <span className="max-w-full truncate">{shortLabel ?? children}</span>
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      {...(variant != null ? { variant } : {})}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      // A phone row has to fit four actions beside the back button at 360px;
      // the toolbar tier's padding would push the fourth onto its own line.
      className={cn(TOOLBAR_CONTROL_CLASS, "gap-1 px-2 sm:gap-1.5 sm:px-2.5", className)}
      {...fullLabel}
      {...props}
    >
      {loading ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <Icon aria-hidden="true" className="size-4" />
      )}
      {shortLabel == null ? (
        <span>{children}</span>
      ) : (
        <>
          <span className="hidden sm:inline">{children}</span>
          <span className="sm:hidden">{shortLabel}</span>
        </>
      )}
    </Button>
  );
}
