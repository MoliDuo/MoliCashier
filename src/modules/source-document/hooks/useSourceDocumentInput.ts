"use client";

import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { toast } from "sonner";
import { useIsTouchInput } from "@/hooks/use-is-touch-input";
import {
  clearDraft,
  draftKey,
  keepDraftInMemory,
  readDraft,
  takeDraftFromMemory,
  writeDraft,
} from "@/lib/drafts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { fireAndForget } from "@/lib/safe-async";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import type { RetrySourceDocumentResponseDto } from "@/modules/source-document/contracts";
import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { editRetrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import type {
  SourceDocumentInputInitialData,
  SourceDocumentInputProps,
} from "../ui/source-document-input.types";
import {
  areImagesEqual,
  buildSubmitPayload,
  createDraftDateState,
  parseStoredInputDraft,
  releaseEditableImage,
  snapshotPayload,
  sourceDocumentPayloadsEqual,
  submitErrorMessageKey,
  toEditableImages,
  toModalImages,
  type DraftDateState,
  type EditableInputImage,
  type StoredInputDraft,
} from "./source-document-input.core";
import { loadSourceDocumentInputFiles } from "./source-document-input-images";
import {
  uploadSourceDocumentSubmissionImages,
  type SourceDocumentSubmissionProgress,
  type SourceDocumentSubmitPayload,
} from "./source-document-submission-upload";
import { useCameraCapture } from "./useCameraCapture";
import { sourceDocumentInputCopy } from "@/copy/source-document";

/** The whole draft, kept in memory while the page lives. */
interface MemoryInputDraft {
  text: string;
  images: EditableInputImage[];
  dateState: DraftDateState;
}

interface CreateVariables {
  payload: SourceDocumentSubmitPayload;
  clientSubmissionId: string;
  signal: AbortSignal;
}

interface RetryVariables {
  payload: SourceDocumentSubmitPayload;
  signal: AbortSignal;
}

interface CreateSubmissionIdentity {
  payload: SourceDocumentSubmitPayload;
  clientSubmissionId: string;
  uploadedPayload: SourceDocumentSubmitPayload | null;
}

function restoreDraft(
  key: string,
  initialData: SourceDocumentInputInitialData | undefined,
  timeZone: string | undefined
): MemoryInputDraft | null {
  const initialDate = createDraftDateState(initialData, timeZone);
  const kept = takeDraftFromMemory<MemoryInputDraft>(key);
  // A default date kept overnight is yesterday by now; only a hand-picked one stays.
  if (kept != null) return kept.dateState.touched ? kept : { ...kept, dateState: initialDate };
  const stored = readDraft(key, parseStoredInputDraft);
  if (stored == null) return null;
  return {
    text: stored.data.text,
    images: toEditableImages(initialData?.images),
    dateState:
      stored.data.entryDate == null
        ? initialDate
        : { ...initialDate, entryDate: new Date(stored.data.entryDate), touched: true },
  };
}

function runAfterPaint(callback: () => void) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => callback());
  } else {
    globalThis.setTimeout(callback, 0);
  }
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => runAfterPaint(resolve));
}

/**
 * Everything the AI record form does: it keeps the typed text, picked images
 * and date as a draft, loads images from the picker, paste, drop and camera,
 * and submits a new record or a retry with upload progress.
 */
export function useSourceDocumentInput(props: SourceDocumentInputProps) {
  const { onSuccess, onPendingChange, onDirtyChange, initialData, timeZone, bookId } = props;
  const [target] = useState(() =>
    props.mode === "retry"
      ? { mode: "retry" as const, sourceDocumentId: props.sourceDocumentId }
      : { mode: "create" as const, sourceDocumentId: null }
  );
  const { mode, sourceDocumentId } = target;
  // Where this form's unsaved input is kept.
  const storageKey =
    sourceDocumentId != null
      ? draftKey("retry", sourceDocumentId)
      : draftKey("new-record-ai", "new");

  // --- The draft ------------------------------------------------------------

  const [restored] = useState(() => restoreDraft(storageKey, initialData, timeZone));
  const [restoredFromDraft, setRestoredFromDraft] = useState(restored != null);
  const [text, setText] = useState(restored?.text ?? initialData?.text ?? "");
  const [images, setImages] = useState<EditableInputImage[]>(
    () => restored?.images ?? toEditableImages(initialData?.images)
  );
  const [dateState, setDateState] = useState<DraftDateState>(
    () => restored?.dateState ?? createDraftDateState(initialData, timeZone)
  );
  const [initialDraft, setInitialDraft] = useState(() => ({
    text: initialData?.text ?? "",
    images: toEditableImages(initialData?.images),
  }));
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const imagesRef = useRef(images);

  const replaceImages = (update: SetStateAction<EditableInputImage[]>) => {
    setImages((current) => {
      const next = typeof update === "function" ? update(current) : update;
      for (const image of current) {
        if (!next.includes(image)) releaseEditableImage(image);
      }
      return next;
    });
  };

  /** After a submit: the form starts over empty and nothing is kept. */
  const resetDraft = () => {
    setText("");
    replaceImages([]);
    setDateState(createDraftDateState(undefined, timeZone));
    setInitialDraft({ text: "", images: [] });
    setSelectedImageIndex(null);
    setRestoredFromDraft(false);
    clearDraft(storageKey);
  };

  /** Drops the kept input and goes back to what the form opened with. */
  const discardDraft = () => {
    setText(initialDraft.text);
    replaceImages(toEditableImages(initialData?.images));
    setDateState(createDraftDateState(initialData, timeZone));
    setSelectedImageIndex(null);
    setRestoredFromDraft(false);
    clearDraft(storageKey);
  };

  // The record's book can change while the dialog stays open, and its zone
  // owns the default date. An untouched default follows the new zone, while a
  // hand-picked date or a retry seed keeps its own. The baseline moves with an
  // untouched default so the form still closes without a discard confirmation.
  if (dateState.timeZone !== timeZone) {
    setDateState((current) =>
      current.timeZone === timeZone
        ? current
        : current.touched || initialData?.entryDate != null
          ? { ...current, timeZone }
          : createDraftDateState(undefined, timeZone)
    );
  }

  const setEntryDate = (date: Date) => {
    setDateState((current) => ({ ...current, entryDate: date, touched: true }));
  };

  const entryDate = dateState.entryDate;
  const isDraftDirty =
    text !== initialDraft.text ||
    !areImagesEqual(images, initialDraft.images) ||
    entryDate.getTime() !== dateState.baseline;
  const hasInput = text !== "" || images.length > 0;

  const latestRef = useRef({ text, images, dateState, isDraftDirty, storageKey });
  useEffect(() => {
    imagesRef.current = images;
    latestRef.current = { text, images, dateState, isDraftDirty, storageKey };
  }, [dateState, storageKey, images, isDraftDirty, text]);

  useEffect(() => {
    if (!isDraftDirty) {
      clearDraft(storageKey);
      return;
    }
    const stored: StoredInputDraft = {
      text,
      entryDate: dateState.touched ? dateState.entryDate.getTime() : null,
    };
    writeDraft(storageKey, stored);
  }, [dateState, storageKey, isDraftDirty, text]);

  // Closing the form keeps an unsaved draft, images included, for the next
  // opening on this page; only a clean form lets its images go.
  useEffect(
    () => () => {
      const latest = latestRef.current;
      if (latest.isDraftDirty) {
        const kept: MemoryInputDraft = {
          text: latest.text,
          images: latest.images,
          dateState: latest.dateState,
        };
        keepDraftInMemory(latest.storageKey, kept);
        return;
      }
      imagesRef.current.forEach(releaseEditableImage);
    },
    []
  );

  // --- Submit progress ------------------------------------------------------

  const [progress, setProgress] = useState<SourceDocumentSubmissionProgress | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => uploadControllerRef.current?.abort(), []);

  const setMonotonicProgress = (next: SourceDocumentSubmissionProgress) => {
    setProgress((current) => {
      if (current?.phase === "cancelling") return current;
      return current != null && current.percent > next.percent
        ? { ...next, percent: current.percent }
        : next;
    });
  };

  const reportSubmitError = (error: Error, fallback: "createError" | "retryError") => {
    const key = submitErrorMessageKey(error, fallback);
    if (key == null) return;
    console.error("Source document submission failed:", error);
    toast.error(sourceDocumentInputCopy[key]);
  };

  const finishUpload = (signal: AbortSignal) => {
    if (uploadControllerRef.current?.signal === signal) {
      uploadControllerRef.current = null;
    }
    setProgress(null);
  };

  const canCancelUpload = progress?.phase === "preparing" || progress?.phase === "uploading";

  const cancelUpload = () => {
    if (!canCancelUpload) return;
    uploadControllerRef.current?.abort();
    setProgress((current) =>
      current == null ? null : { ...current, phase: "cancelling" as const }
    );
  };

  // --- Submit ---------------------------------------------------------------

  const createSubmissionIdentityRef = useRef<CreateSubmissionIdentity | null>(null);

  const completeSubmit = async (documentDate: string, id: string, signal: AbortSignal) => {
    try {
      setMonotonicProgress({ phase: "complete", percent: 100 });
      await waitForPaint();
      resetDraft();
      onSuccess?.({ sourceDocumentId: id, documentDate });
    } finally {
      finishUpload(signal);
    }
  };

  const createMutation = useLedgerMutation<
    Awaited<ReturnType<typeof createSourceDocumentAction>>,
    CreateVariables
  >({
    mutationFn: async (variables) => {
      const currentIdentity = createSubmissionIdentityRef.current;
      let uploadedPayload =
        currentIdentity?.clientSubmissionId === variables.clientSubmissionId
          ? currentIdentity.uploadedPayload
          : null;
      if (uploadedPayload == null) {
        uploadedPayload = await uploadSourceDocumentSubmissionImages(
          variables.payload,
          { signal: variables.signal },
          setMonotonicProgress
        );
        if (
          createSubmissionIdentityRef.current?.clientSubmissionId === variables.clientSubmissionId
        ) {
          createSubmissionIdentityRef.current.uploadedPayload = uploadedPayload;
        }
      }
      setMonotonicProgress({ phase: "submitting", percent: 90 });
      return createSourceDocumentAction(
        {
          ...(bookId == null ? {} : { bookId }),
          ...(uploadedPayload.text == null ? {} : { text: uploadedPayload.text }),
          storedFileIds: uploadedPayload.storedFileIds,
          ...(uploadedPayload.documentDate == null
            ? {}
            : { documentDate: uploadedPayload.documentDate }),
        },
        variables.clientSubmissionId
      );
    },
    successMessage: null,
    errorMessage: null,
    onSuccess: async (data, variables) => {
      if (
        createSubmissionIdentityRef.current?.clientSubmissionId === variables.clientSubmissionId
      ) {
        createSubmissionIdentityRef.current = null;
      }
      await completeSubmit(variables.payload.documentDate, data.sourceDocumentId, variables.signal);
    },
    onError: (error, variables) => {
      reportSubmitError(error, "createError");
      finishUpload(variables.signal);
    },
  });

  const retryMutation = useLedgerMutation<RetrySourceDocumentResponseDto, RetryVariables>({
    mutationFn: async ({ payload, signal }) => {
      if (sourceDocumentId == null) throw new Error("No source document ID for retry");
      const uploadedPayload = await uploadSourceDocumentSubmissionImages(
        payload,
        { signal },
        setMonotonicProgress
      );
      setMonotonicProgress({ phase: "submitting", percent: 90 });
      return editRetrySourceDocumentAction(sourceDocumentId, uploadedPayload);
    },
    successMessage: sourceDocumentInputCopy.retrySuccess,
    errorMessage: null,
    onSuccess: async (_data, variables) => {
      await completeSubmit(variables.payload.documentDate, sourceDocumentId!, variables.signal);
    },
    onError: (error, variables) => {
      reportSubmitError(error, "retryError");
      finishUpload(variables.signal);
    },
  });

  const activeMutation = mode === "retry" ? retryMutation : createMutation;
  const isSubmitting = activeMutation.isPending || progress != null;

  const submit = (payload: SourceDocumentSubmitPayload) => {
    if (isSubmitting) return;
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setProgress({ phase: "preparing", percent: 0 });
    if (mode === "create") {
      const currentIdentity = createSubmissionIdentityRef.current;
      if (
        currentIdentity == null ||
        !sourceDocumentPayloadsEqual(currentIdentity.payload, payload)
      ) {
        createSubmissionIdentityRef.current = {
          payload: snapshotPayload(payload),
          clientSubmissionId: crypto.randomUUID(),
          uploadedPayload: null,
        };
      }
    }
    // The progress bar paints before the upload starts compressing images.
    runAfterPaint(() => {
      if (controller.signal.aborted) {
        if (uploadControllerRef.current === controller) {
          uploadControllerRef.current = null;
          setProgress(null);
        }
        return;
      }
      if (mode === "retry") {
        retryMutation.mutate({ payload, signal: controller.signal });
        return;
      }
      createMutation.mutate({
        payload,
        clientSubmissionId: createSubmissionIdentityRef.current!.clientSubmissionId,
        signal: controller.signal,
      });
    });
  };

  // --- Images ---------------------------------------------------------------

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileReservationsRef = useRef(0);
  const mountedRef = useRef(true);
  const compressionAbortRef = useRef<AbortController | null>(null);
  const [pendingFileCount, setPendingFileCount] = useState(0);
  const imageCountRef = useRef(images.length);
  useLayoutEffect(() => {
    imageCountRef.current = images.length;
  }, [images.length]);
  useEffect(() => {
    const compressionAbort = new AbortController();
    compressionAbortRef.current = compressionAbort;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      compressionAbort.abort();
      if (compressionAbortRef.current === compressionAbort) compressionAbortRef.current = null;
    };
  }, []);

  const appendFiles = async (files: File[]) => {
    const tooManyImages = sourceDocumentInputCopy.tooManyImages({ count: MAX_FILES });
    const remainingCapacity = Math.max(
      0,
      MAX_FILES - imageCountRef.current - pendingFileReservationsRef.current
    );
    if (files.length > remainingCapacity) {
      toast.error(tooManyImages);
    }
    if (remainingCapacity === 0) return;
    const reservedFiles = files.slice(0, remainingCapacity);
    pendingFileReservationsRef.current += reservedFiles.length;
    setPendingFileCount(pendingFileReservationsRef.current);
    let results: Awaited<ReturnType<typeof loadSourceDocumentInputFiles>>;
    try {
      results = await loadSourceDocumentInputFiles(
        reservedFiles,
        compressionAbortRef.current?.signal
      );
    } finally {
      pendingFileReservationsRef.current -= reservedFiles.length;
      if (mountedRef.current) setPendingFileCount(pendingFileReservationsRef.current);
    }

    if (!mountedRef.current) return;

    const loadedImages = results.flatMap((result) => {
      if (result.kind === "too-large") {
        toast.error(sourceDocumentInputCopy.imageTooLarge({ fileName: result.fileName }));
        return [];
      }
      if (result.kind === "unsupported") {
        toast.error(sourceDocumentInputCopy.imageUnsupported({ fileName: result.fileName }));
        return [];
      }
      return [result.image];
    });
    const acceptedImages = loadedImages.slice(0, Math.max(0, MAX_FILES - imageCountRef.current));
    if (acceptedImages.length < loadedImages.length) toast.error(tooManyImages);
    if (acceptedImages.length === 0) return;
    imageCountRef.current += acceptedImages.length;
    replaceImages((previousImages) => [
      ...previousImages,
      ...acceptedImages.slice(0, Math.max(0, MAX_FILES - previousImages.length)),
    ]);
  };

  const addImageFiles = (files: File[]) => {
    if (files.length === 0) return;
    fireAndForget(appendFiles(files), { context: "SourceDocumentInput.addImages" });
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    fireAndForget(appendFiles(files), {
      context: "SourceDocumentInput.processFiles",
    });
  };

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];

    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;

      const file = item.getAsFile();
      if (file != null) {
        files.push(file);
      }
    }

    if (files.length === 0) return;

    fireAndForget(appendFiles(files), {
      context: "SourceDocumentInput.processFiles",
    });
  };

  const handleSubmit = () => {
    if (!hasInput) return;

    submit(buildSubmitPayload(text, images, entryDate));
  };

  // --- Camera ---------------------------------------------------------------

  // The camera waits to be asked for, so opening the dialog never prompts for it.
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const isTouchInput = useIsTouchInput();
  const camera = useCameraCapture({
    enabled: isTouchInput && mode === "create" && isCameraOpen && !isSubmitting,
    onCapture: (file) => addImageFiles([file]),
  });

  // --- The dialog around the form -------------------------------------------

  const isDirty = isDraftDirty || pendingFileCount > 0;

  useEffect(() => {
    onPendingChange?.(isSubmitting);
    return () => onPendingChange?.(false);
  }, [isSubmitting, onPendingChange]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  return {
    mode,
    text,
    entryDate,
    images: toModalImages(images),
    selectedImageIndex,
    fileInputRef,
    isPending: pendingFileCount > 0 || isSubmitting,
    isPreparingImages: pendingFileCount > 0,
    isSubmitting,
    progress,
    canCancelUpload,
    canSubmit: hasInput && pendingFileCount === 0,
    /** True while the form shows input restored from an earlier visit. */
    restoredFromDraft: restoredFromDraft && isDraftDirty,
    discardDraft,
    remainingImageSlots: Math.max(0, MAX_FILES - images.length - pendingFileCount),
    isTouchInput,
    camera,
    isCameraOpen,
    openCamera: () => setIsCameraOpen(true),
    collapseCamera: () => setIsCameraOpen(false),
    setText,
    setEntryDate,
    openImage: (index: number) => setSelectedImageIndex(index),
    closeImage: () => setSelectedImageIndex(null),
    removeImage: (index: number) =>
      replaceImages((previousImages) =>
        previousImages.filter((_, imageIndex) => imageIndex !== index)
      ),
    addImageFiles,
    triggerFileDialog: () => fileInputRef.current?.click(),
    handleFileInputChange,
    handleTextareaPaste,
    handleSubmit,
    cancelUpload,
  };
}
