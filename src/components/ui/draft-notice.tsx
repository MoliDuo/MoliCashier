"use client";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { commonCopy } from "@/copy/common";

interface DraftNoticeProps {
  /** The draft was made against a version that has since changed. */
  outdated?: boolean;
  disabled?: boolean;
  onDiscard: () => void;
}

/** Says a form holds input kept from an earlier visit, with a way to drop it. */
export function DraftNotice({ outdated = false, disabled = false, onDiscard }: DraftNoticeProps) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface2 px-3 py-2"
    >
      <p className={textRoleClassName("meta")}>
        {outdated ? commonCopy.draftOutdated : commonCopy.draftRestored}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-md:h-11"
        disabled={disabled}
        onClick={onDiscard}
      >
        {commonCopy.discard}
      </Button>
    </div>
  );
}
