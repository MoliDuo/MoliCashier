import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { textRoleClassName } from "@/components/typography";

interface SettingsFieldProps {
  title: string;
  /** What the field changes, when the name alone does not say it. */
  description?: string;
  /** Buttons that act on this whole field, aligned with its heading. */
  actions?: ReactNode;
  stacked?: boolean;
  /**
   * Keeps the control beside the title at every width, for a switch, which is
   * too small to need a row of its own on a phone.
   */
  inline?: boolean;
  /**
   * Omitted when the heading and its actions are the whole field — 退出登录 has
   * nothing under its button — so no empty row is left behind.
   */
  children?: ReactNode;
}

export function SettingsField({
  title,
  description,
  actions,
  stacked = false,
  inline = false,
  children,
}: SettingsFieldProps) {
  return (
    <div
      className={cn(
        inline ? "flex flex-row items-center justify-between gap-3" : "flex flex-col gap-3",
        !stacked && !inline && "sm:flex-row sm:items-center sm:justify-between"
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          inline && "min-w-0 flex-1"
        )}
      >
        <div className="min-w-0">
          <h3 className={textRoleClassName("bodyStrong")}>{title}</h3>
          {description != null && (
            <p className={textRoleClassName("meta", "mt-0.5")}>{description}</p>
          )}
        </div>
        {actions != null && <div className="shrink-0">{actions}</div>}
      </div>
      {children != null && (
        <div className={cn(inline ? "shrink-0" : stacked ? "w-full" : "sm:max-w-md")}>
          {children}
        </div>
      )}
    </div>
  );
}
