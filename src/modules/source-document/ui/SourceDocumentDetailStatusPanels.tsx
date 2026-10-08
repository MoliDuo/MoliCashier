"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { AmountText } from "@/modules/currency/ui/amount-text";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import { diagnosticDescription, diagnosticLabel } from "./diagnostic-messages";
import { commonCopy } from "@/copy/common";
import { diagnosticCodeCopy, sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentDetailStatusPanelsProps {
  sourceDocument: SourceDocumentDetailDto | null;
  loadError: boolean;
  isLoading: boolean;
  isReloading: boolean;
  onClose: () => void;
  onReload: () => void;
}

/**
 * Loading/error skeletons plus the diagnostic and retained-result banners
 * shown above the document body.
 */
export function SourceDocumentDetailStatusPanels({
  sourceDocument,
  loadError,
  isLoading,
  isReloading,
  onClose,
  onReload,
}: SourceDocumentDetailStatusPanelsProps) {
  return (
    <>
      {loadError && !sourceDocument ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
          <p className={textRoleClassName("bodyStrong")}>{sourceDocumentDetailCopy.loadError}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isReloading}>
              {commonCopy.close}
            </Button>
            <Button onClick={onReload} disabled={isReloading}>
              <RefreshCw className={cn("size-4", isReloading && "animate-spin")} />
              {commonCopy.retry}
            </Button>
          </div>
        </div>
      ) : null}
      {isLoading && !sourceDocument && (
        <div className="space-y-3 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded bg-border" />
            <div className="h-3 w-24 bg-border rounded" />
          </div>
          <div className="rounded-xl border border-border p-3 space-y-2">
            <div className="h-3 w-16 bg-border rounded" />
            <div className="h-6 w-28 bg-border rounded" />
          </div>
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-border"
              >
                <div className="h-8 w-8 rounded-full bg-border" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-28 bg-border rounded" />
                  <div className="h-2.5 w-16 bg-border rounded" />
                </div>
                <div className="h-3.5 w-14 bg-border rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {sourceDocument && (
        <>
          {sourceDocument.processingStatus === "failed" && (
            <div className="mb-3 px-1">
              {(() => {
                // A document the AI could not turn into expenses shows one
                // status plus the reason the AI wrote for the ledger owner.
                const isUnparsable = sourceDocument.failureKind === "invalid_input";
                const failureCode = sourceDocument.errorCode ?? "processing_unavailable";
                const title = isUnparsable
                  ? diagnosticCodeCopy.unparsableDocument
                  : diagnosticLabel(failureCode);
                const description = isUnparsable
                  ? sourceDocument.failureMessage || diagnosticCodeCopy.unparsableDocumentDesc
                  : diagnosticDescription(failureCode);
                return (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-danger/5 border border-danger/10">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
                    <div className="flex flex-col gap-0.5">
                      <span className={textRoleClassName("meta", "font-medium text-danger")}>
                        {title}
                      </span>
                      <span className={textRoleClassName("micro")}>{description}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {/* Retained active result notice */}
          {sourceDocument.processingStatus === "failed" &&
            sourceDocument.activeResultSummary != null && (
              <div className="mb-3 px-1">
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/10">
                  <div className="flex flex-col gap-0.5">
                    <span className={textRoleClassName("meta", "font-medium text-primary")}>
                      {sourceDocumentDetailCopy.activeResultTitle}
                    </span>
                    <span className={textRoleClassName("micro")}>
                      {sourceDocumentDetailCopy.activeResultDescription}
                    </span>
                    <AmountText variant="caption">
                      {sourceDocument.activeResultSummary.entryCount} ·{" "}
                      {sourceDocument.activeResultSummary.total ?? "—"}
                    </AmountText>
                  </div>
                </div>
              </div>
            )}
        </>
      )}
    </>
  );
}
