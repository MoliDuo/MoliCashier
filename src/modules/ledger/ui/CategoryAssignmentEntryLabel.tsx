import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { batchActionsCopy } from "@/copy/workspace";
import type { CategoryAssignmentEntryState } from "./category-assignment-entry-states";

/**
 * The word a row prints while the assignment run is working on it, or after the
 * run could not place it. Worded and toned like a source-document card's own
 * 处理中 and failure labels, so both kinds of background work read alike.
 */
export function CategoryAssignmentEntryLabel({
  state,
  className,
}: {
  state: CategoryAssignmentEntryState;
  className?: string;
}) {
  const failed = state === "failed";
  const label = failed
    ? batchActionsCopy.categoryEntryFailed
    : batchActionsCopy.categoryEntryPending;
  return (
    <span
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      data-testid="category-assignment-entry-label"
      className={cn(
        textRoleClassName("meta", "shrink-0 font-medium"),
        failed ? "text-danger" : "text-primary",
        className
      )}
    >
      {label}
    </span>
  );
}
