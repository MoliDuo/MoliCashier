"use client";
import { useState } from "react";
import Image from "next/image";
import { FileText, ImagePlay, Maximize2 } from "lucide-react";
import type { SourceDocumentDetailDto } from "@/modules/source-document/contracts";
import { textRoleClassName } from "@/components/typography";
import { storedFileReadUrl } from "../../../stored-file-read";
import { SourceDocumentImageModal } from "../../SourceDocumentImageModal";
import { sourceDocumentCardCopy, sourceDocumentDetailCopy } from "@/copy/source-document";

interface SourceDocumentRawEvidenceProps {
  sourceDocument: SourceDocumentDetailDto;
}

export function SourceDocumentRawEvidence({ sourceDocument }: SourceDocumentRawEvidenceProps) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const files = sourceDocument.files;
  const hasImages = files.length > 0;
  const hasRawText = sourceDocument.text != null && sourceDocument.text.trim().length > 0;

  return (
    <>
      <section className="shrink-0 overflow-hidden rounded-lg border border-border/60 bg-surface2/20">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2.5">
          <div className={textRoleClassName("meta", "flex items-center gap-2 font-semibold")}>
            <FileText className="h-3 w-3 text-primary/70" />
            {sourceDocumentDetailCopy.rawEvidence}
            {(hasImages || hasRawText) && (
              <span className={textRoleClassName("meta", "font-normal")}>
                (
                {[
                  hasImages && `${files.length} ${sourceDocumentCardCopy.image}`,
                  hasRawText && sourceDocumentDetailCopy.rawContent,
                ]
                  .filter(Boolean)
                  .join(", ")}
                )
              </span>
            )}
          </div>
        </header>

        <div className="space-y-4 px-3 pb-3 pt-3">
          {!hasImages && !hasRawText ? (
            <p className={textRoleClassName("bodyMuted", "px-3 py-6 text-center")}>
              {sourceDocumentDetailCopy.noEvidence}
            </p>
          ) : null}
          {hasImages && (
            <div>
              <h3
                className={textRoleClassName("meta", "mb-2 flex items-center gap-1.5 font-medium")}
              >
                <ImagePlay className="h-3 w-3 text-primary/60" />
                {sourceDocumentCardCopy.image}
              </h3>
              {files.length === 1 && files[0] != null ? (
                <button
                  type="button"
                  data-testid="source-document-image-stage"
                  className="group relative flex w-full items-center justify-center rounded-md border border-border/60 bg-surface2/70 transition-[border-color,background-color] duration-[var(--motion-feedback)]"
                  onClick={() => setViewerIndex(0)}
                  aria-label={sourceDocumentCardCopy.imageAlt({ index: 1 })}
                >
                  <Image
                    src={storedFileReadUrl(files[0].id)}
                    alt={sourceDocumentCardCopy.imageAlt({ index: 1 })}
                    width={1200}
                    height={2400}
                    className="h-auto max-h-[70dvh] w-auto max-w-full object-contain p-2"
                  />
                  <span className="fine-pointer-reveal absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-text/70 text-bg opacity-0 transition-opacity duration-[var(--motion-feedback)] group-focus-visible:opacity-100 group-active:opacity-100">
                    <Maximize2 className="h-4 w-4" />
                  </span>
                </button>
              ) : (
                <div
                  role="group"
                  data-testid="source-document-image-grid"
                  className="grid grid-cols-3 gap-2"
                  aria-label={sourceDocumentCardCopy.image}
                >
                  {files.map((file, index) => (
                    <button
                      key={file.id}
                      type="button"
                      className="group relative aspect-square overflow-hidden rounded-md border border-border/60 bg-surface2 transition-opacity duration-[var(--motion-feedback)] hover:opacity-90"
                      onClick={() => setViewerIndex(index)}
                      aria-label={sourceDocumentCardCopy.imageAlt({ index: index + 1 })}
                    >
                      <Image
                        src={storedFileReadUrl(file.id)}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 10rem, 33vw"
                        className="object-cover object-top"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasRawText && (
            <div>
              <h3 className={textRoleClassName("meta", "mb-2 font-medium")}>
                {sourceDocumentDetailCopy.rawContent}
              </h3>
              <div
                className={textRoleClassName(
                  "body",
                  "whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-surface/50 p-3 leading-relaxed text-text/70"
                )}
              >
                {sourceDocument.text}
              </div>
            </div>
          )}
        </div>
      </section>

      <SourceDocumentImageModal
        images={files.map((file) => ({
          data: "",
          mimeType: file.contentType,
          storedFileId: file.id,
        }))}
        initialIndex={viewerIndex ?? 0}
        open={viewerIndex !== null}
        onOpenChange={(open: boolean) => !open && setViewerIndex(null)}
      />
    </>
  );
}
