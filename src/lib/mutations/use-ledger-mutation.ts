import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { syncLedgerAfterWrite } from "@/lib/mutations/ledger-sync";
import { commonCopy } from "@/copy/common";

export interface UseLedgerMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /**
   * What the command waits for before it counts as done. By default the whole
   * visible ledger has read again. A key waits for that one query — an editor
   * waiting on its own record — and false waits for nothing, so a background
   * list refresh never holds a finished command pending.
   */
  waitFor?: QueryKey | false;
  successMessage?: string | null;
  /**
   * The toast a failure shows; "保存失败" unless the caller names another. A
   * caller that reports the failure itself passes null, so nothing fails silently
   * by omission.
   */
  errorMessage?: string | null;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables | undefined
  ) => void | Promise<void>;
}

export function useLedgerMutation<TData = unknown, TVariables = void>(
  options: UseLedgerMutationOptions<TData, TVariables>
) {
  const queryClient = useQueryClient();
  const {
    mutationFn,
    waitFor,
    successMessage,
    errorMessage = commonCopy.saveFailed,
    onSuccess,
    onError,
    onSettled,
  } = options;

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    onSuccess: async (data, variables) => {
      try {
        await onSuccess?.(data, variables);
      } catch (error) {
        console.error("[useLedgerMutation] success callback failed", { error });
      }

      if (successMessage != null) toast.success(successMessage);

      const refresh = async () => {
        try {
          await syncLedgerAfterWrite(queryClient);
        } catch (refreshError) {
          console.error("[useLedgerMutation] ledger refresh failed", { error: refreshError });
          toast.error(commonCopy.savedRefreshFailed);
          globalThis.setTimeout(() => {
            void syncLedgerAfterWrite(queryClient).catch((retryError) => {
              console.error("[useLedgerMutation] ledger refresh retry failed", {
                error: retryError,
              });
            });
          }, 1_000);
        }
      };
      if (waitFor === undefined) {
        await refresh();
        return;
      }
      void refresh();
      if (waitFor !== false) {
        await queryClient.refetchQueries(
          { queryKey: waitFor, exact: true, type: "active" },
          { cancelRefetch: false }
        );
      }
    },
    onError: (error, variables) => {
      if (errorMessage != null) toast.error(errorMessage);
      onError?.(error, variables);
    },
    ...(onSettled === undefined ? {} : { onSettled }),
  });
}
