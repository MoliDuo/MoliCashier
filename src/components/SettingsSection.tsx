import type { ReactNode } from "react";

interface SettingsSectionProps {
  /**
   * The buttons that act on the whole section — such as 管理分类 — on a row of
   * their own above the fields they cover.
   */
  actions?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ actions, children }: SettingsSectionProps) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      {actions != null && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
      <div className="[&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
        {children}
      </div>
    </section>
  );
}
