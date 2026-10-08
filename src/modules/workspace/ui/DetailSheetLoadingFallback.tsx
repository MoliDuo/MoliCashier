"use client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeLedgerDetail } from "@/modules/ledger/navigation/ledger-detail-navigation";
import { commonCopy } from "@/copy/common";

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

/** The sheet's outline while its code loads; closing it closes the record. */
export function DetailSheetLoadingFallback() {
  return (
    <Dialog open onOpenChange={(open) => !open && closeLedgerDetail()} closeOnBack={false}>
      <DialogContent
        variant="detail"
        className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{commonCopy.loading}</DialogTitle>
        <DialogHeader className="shrink-0 border-b px-12 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:py-3">
          <Skeleton className="h-5 w-40" />
        </DialogHeader>
        <div className="flex-1 space-y-3 p-3 sm:p-4" role="status" aria-busy="true">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-3" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-28" />
          </div>
          {[1, 2].map((index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
