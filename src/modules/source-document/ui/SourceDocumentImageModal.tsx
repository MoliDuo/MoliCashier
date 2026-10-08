"use client";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";
import { textRoleClassName } from "@/components/typography";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { storedFileReadUrl } from "./stored-file-read";
import { sourceDocumentImageModalCopy } from "@/copy/source-document";

export interface SourceDocumentModalImage {
  data: string;
  mimeType: string;
  storedFileId?: string;
}

function imageSource(image: SourceDocumentModalImage): string {
  return image.storedFileId == null ? image.data : storedFileReadUrl(image.storedFileId);
}

interface SourceDocumentImageModalProps {
  images: SourceDocumentModalImage[];
  initialIndex?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SourceDocumentImageModal({
  images,
  initialIndex = 0,
  open,
  onOpenChange,
}: SourceDocumentImageModalProps) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const hasImages = images.length > 0;
  const resetKey = `${open}:${initialIndex}:${images.length}`;
  const [navigation, setNavigation] = useState({ resetKey, index: initialIndex });
  const requestedIndex = navigation.resetKey === resetKey ? navigation.index : initialIndex;
  const currentIndex = Math.min(requestedIndex, Math.max(0, images.length - 1));
  const setCurrentIndex = (update: SetStateAction<number>) => {
    setNavigation({
      resetKey,
      index: typeof update === "function" ? update(currentIndex) : update,
    });
  };
  const currentImage = hasImages ? images[currentIndex] : null;
  const viewResetKey = `${open}:${currentIndex}:${currentImage?.storedFileId ?? currentImage?.data ?? ""}`;
  const [storedView, setStoredView] = useState({ resetKey: viewResetKey, scale: 1, x: 0, y: 0 });
  const [draggingState, setDraggingState] = useState({ resetKey: viewResetKey, value: false });
  const view =
    storedView.resetKey === viewResetKey
      ? storedView
      : { resetKey: viewResetKey, scale: 1, x: 0, y: 0 };
  const isDragging = draggingState.resetKey === viewResetKey && draggingState.value;
  const setView = useCallback(
    (update: SetStateAction<{ scale: number; x: number; y: number }>) => {
      setStoredView((previous) => {
        const current =
          previous.resetKey === viewResetKey
            ? previous
            : { resetKey: viewResetKey, scale: 1, x: 0, y: 0 };
        const next = typeof update === "function" ? update(current) : update;
        return { resetKey: viewResetKey, ...next };
      });
    },
    [viewResetKey]
  );
  const setIsDragging = useCallback(
    (value: boolean) => setDraggingState({ resetKey: viewResetKey, value }),
    [viewResetKey]
  );

  const clampTranslation = useCallback((scale: number, x: number, y: number) => {
    const viewport = viewportRef.current;
    if (viewport == null || scale <= 1) return { x: 0, y: 0 };
    const maxX = (viewport.clientWidth * (scale - 1)) / 2;
    const maxY = (viewport.clientHeight * (scale - 1)) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  }, []);
  const setScale = useCallback(
    (nextScale: number) => {
      const scale = Math.max(1, Math.min(4, nextScale));
      setView((previous) => ({ scale, ...clampTranslation(scale, previous.x, previous.y) }));
    },
    [clampTranslation, setView]
  );
  const resetView = useCallback(() => {
    pointersRef.current.clear();
    pinchRef.current = null;
    setIsDragging(false);
    setView({ scale: 1, x: 0, y: 0 });
  }, [setIsDragging, setView]);

  const title = !hasImages
    ? ""
    : images.length === 1
      ? sourceDocumentImageModalCopy.title
      : sourceDocumentImageModalCopy.titleWithIndex({
          current: currentIndex + 1,
          total: images.length,
        });

  if (!hasImages) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
        } else {
          if (view.scale === 1 && !isDragging) onOpenChange(false);
        }
      }}
    >
      <DialogContent
        variant="viewer"
        aria-describedby={undefined}
        className="flex flex-col gap-0 overflow-hidden border-0 p-0 shadow-none [&>button]:hidden sm:border sm:shadow-modal"
        onOpenAutoFocus={() => {
          restoreFocusRef.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusRef.current?.focus();
        }}
        onPointerDownOutside={(event) => {
          if (view.scale > 1 || isDragging) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            setCurrentIndex((previous) => Math.max(0, previous - 1));
          }
          if (event.key === "ArrowRight") {
            setCurrentIndex((previous) => Math.min(images.length - 1, previous + 1));
          }
          if (event.key === "+" || event.key === "=") setScale(view.scale + 0.5);
          if (event.key === "-") setScale(view.scale - 0.5);
          if (event.key === "0") resetView();
        }}
      >
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between border-b px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:py-4">
          <DialogTitle>{title}</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setScale(view.scale - 0.5)}
              disabled={view.scale <= 1}
              aria-label={sourceDocumentImageModalCopy.zoomOut}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span
              className={textRoleClassName("body", "min-w-12 text-center tabular-nums")}
              aria-live="polite"
            >
              {view.scale.toFixed(1)}×
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setScale(view.scale + 0.5)}
              disabled={view.scale >= 4}
              aria-label={sourceDocumentImageModalCopy.zoomIn}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={resetView}
              disabled={view.scale === 1 && view.x === 0 && view.y === 0}
              aria-label={sourceDocumentImageModalCopy.resetZoom}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-11 w-11 sm:h-9 sm:w-9"
              onClick={() => onOpenChange(false)}
              aria-label={sourceDocumentImageModalCopy.close}
              title={sourceDocumentImageModalCopy.close}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col bg-muted/40">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden sm:p-4">
            {images.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2"
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                aria-label={sourceDocumentImageModalCopy.previous}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}

            <div
              ref={viewportRef}
              className="relative h-full w-full overflow-hidden touch-none"
              onDoubleClick={() => setScale(view.scale === 1 ? 2 : 1)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                setIsDragging(view.scale > 1);
                if (pointersRef.current.size === 2) {
                  const [a, b] = [...pointersRef.current.values()];
                  if (a && b)
                    pinchRef.current = {
                      distance: Math.hypot(a.x - b.x, a.y - b.y),
                      scale: view.scale,
                    };
                }
              }}
              onPointerMove={(event) => {
                const previous = pointersRef.current.get(event.pointerId);
                if (previous == null) return;
                pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const points = [...pointersRef.current.values()];
                if (points.length >= 2 && pinchRef.current != null) {
                  const [a, b] = points;
                  if (a && b)
                    setScale(
                      pinchRef.current.scale *
                        (Math.hypot(a.x - b.x, a.y - b.y) / pinchRef.current.distance)
                    );
                  return;
                }
                if (view.scale > 1) {
                  const dx = event.clientX - previous.x;
                  const dy = event.clientY - previous.y;
                  setView((current) => ({
                    scale: current.scale,
                    ...clampTranslation(current.scale, current.x + dx, current.y + dy),
                  }));
                }
              }}
              onPointerUp={(event) => {
                pointersRef.current.delete(event.pointerId);
                pinchRef.current = null;
                setIsDragging(pointersRef.current.size > 0 && view.scale > 1);
              }}
              onPointerCancel={(event) => {
                pointersRef.current.delete(event.pointerId);
                pinchRef.current = null;
                setIsDragging(false);
              }}
            >
              <Image
                src={currentImage == null ? "" : imageSource(currentImage)}
                alt={sourceDocumentImageModalCopy.imageAlt({ index: currentIndex + 1 })}
                fill
                unoptimized
                className="select-none object-contain"
                draggable={false}
                style={{
                  transform:
                    "translate3d(" + view.x + "px, " + view.y + "px, 0) scale(" + view.scale + ")",
                }}
              />
            </div>

            {images.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2"
                onClick={() => setCurrentIndex((prev) => Math.min(images.length - 1, prev + 1))}
                disabled={currentIndex === images.length - 1}
                aria-label={sourceDocumentImageModalCopy.next}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:py-3">
              {images.map((image, index) => (
                <button
                  key={`${image.storedFileId ?? image.data}-${index}`}
                  type="button"
                  onClick={() => setCurrentIndex(index)}
                  className={cn(
                    "relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-surface",
                    currentIndex === index ? "border-primary" : "border-transparent"
                  )}
                  aria-label={sourceDocumentImageModalCopy.imageAlt({ index: index + 1 })}
                  aria-current={currentIndex === index ? "true" : undefined}
                >
                  <Image
                    src={imageSource(image)}
                    alt={sourceDocumentImageModalCopy.imageAlt({ index: index + 1 })}
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
