"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";
import { commonCopy } from "@/copy/common";
import { useOverlayHistory } from "@/lib/navigation/overlay-history";

const DialogDepthContext = React.createContext(0);

function Dialog({
  closeOnBack = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  /**
   * Back — an iPhone's edge swipe — closes the dialog rather than leaving the
   * page under it. A dialog whose open state already lives in the URL, where
   * Back reaches it on its own, turns this off.
   */
  closeOnBack?: boolean;
}) {
  const parentDepth = React.useContext(DialogDepthContext);
  const { open = false, onOpenChange } = props;
  useOverlayHistory(open, () => onOpenChange?.(false), closeOnBack);
  return (
    <DialogDepthContext.Provider value={parentDepth + 1}>
      <DialogPrimitive.Root {...props} />
    </DialogDepthContext.Provider>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => {
  const depth = React.useContext(DialogDepthContext) - 1;
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      style={{ ...style, zIndex: 100 + depth * 20 }}
      {...props}
    />
  );
});
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogLayout = "modal" | "sheet" | "detail" | "viewer";

const dialogLayoutClasses: Record<DialogLayout, string> = {
  modal:
    "left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
  sheet:
    "bottom-0 left-0 w-full max-w-none rounded-t-lg data-[state=closed]:slide-out-to-bottom-3 data-[state=open]:slide-in-from-bottom-3 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
  detail:
    "inset-0 h-[100dvh] w-screen max-w-none rounded-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
  viewer:
    "inset-0 h-[100dvh] w-screen max-w-none rounded-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[90dvh] sm:w-[95vw] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    variant: DialogLayout;
    hideCloseButton?: boolean;
    onExitComplete?: () => void;
  }
>(
  (
    {
      className,
      children,
      variant,
      hideCloseButton = false,
      onExitComplete,
      onInteractOutside,
      onOpenAutoFocus,
      onCloseAutoFocus,
      style,
      ...props
    },
    ref
  ) => {
    const depth = React.useContext(DialogDepthContext) - 1;
    return (
      <DialogPortal>
        <DialogOverlay className="duration-200" />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed grid gap-4 border border-border bg-surface p-6 shadow-modal duration-200 focus-visible:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            dialogLayoutClasses[variant],
            className
          )}
          style={{ ...style, zIndex: 110 + depth * 20 }}
          onOpenAutoFocus={(event) => {
            onOpenAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) {
              const initialFocus =
                event.currentTarget.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
                event.currentTarget;
              initialFocus.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            onExitComplete?.();
          }}
          {...props}
          onInteractOutside={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-sonner-toast]")) {
              event.preventDefault();
              return;
            }
            onInteractOutside?.(event);
          }}
        >
          {children}
          {hideCloseButton ? null : (
            <DialogPrimitive.Close
              className={cn(
                "absolute right-2 top-2 flex size-11 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:right-4 sm:top-4 sm:size-8",
                // A full-screen sheet pads its header below the status bar, so
                // the close control follows it down instead of sitting under it.
                variant === "detail" && "top-[max(0.5rem,calc(env(safe-area-inset-top)-0.5rem))]"
              )}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">{commonCopy.close}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
      {...props}
    />
  );
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      textRoleClassName("dialogTitle", "leading-none focus-visible:outline-none"),
      className
    )}
    data-dialog-initial-focus=""
    tabIndex={-1}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(textRoleClassName("bodyMuted"), className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
