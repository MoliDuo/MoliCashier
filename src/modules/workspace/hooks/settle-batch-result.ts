import { toast } from "sonner";
import type { PartialBatchCommandResult } from "@/modules/source-document/contracts";
import { batchActionsCopy } from "@/copy/workspace";

/**
 * Settles a batch that may have gone through only in part, the same way on
 * 账目 and 明细. Selecting freezes the list, so a batch that went through
 * leaves selection mode: the list reads again and the rows it removed or moved
 * go away. Only the items that failed stay selected, to retry.
 */
export function settleBatchResult(
  result: PartialBatchCommandResult,
  {
    successLabel,
    exitSelectionMode,
    retainSelection,
  }: {
    successLabel: string;
    exitSelectionMode: () => void;
    retainSelection: (ids: string[]) => void;
  }
): void {
  const unresolved = result.failed.map((item) => item.id);
  if (unresolved.length === 0) exitSelectionMode();
  else retainSelection(unresolved);
  if (result.succeeded.length > 0) toast.success(successLabel);
  if (unresolved.length > 0) {
    toast.warning(
      batchActionsCopy.partialResult({
        succeeded: result.succeeded.length,
        failed: unresolved.length,
      })
    );
  }
}
