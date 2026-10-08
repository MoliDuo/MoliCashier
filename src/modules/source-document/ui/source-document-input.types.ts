import type { ReactNode } from "react";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";

interface SourceDocumentInputBaseProps {
  bookId?: string;
  onSuccess?: (result: CreatedRecordResult) => void;
  onPendingChange?: (pending: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  timeZone?: string;
  /** Shown at the start of the form's footer, beside the submit — the book picker. */
  footerStart?: ReactNode;
  /** Shown at the end of the date row — the new-record sheet's close control. */
  dateEnd?: ReactNode;
  initialData?: {
    text?: string;
    images?: Array<{ data: string; mimeType: string; storedFileId?: string }>;
    entryDate?: string;
  };
}

export type SourceDocumentInputProps = SourceDocumentInputBaseProps &
  (
    | { mode?: "create"; sourceDocumentId?: never }
    | {
        mode: "retry";
        sourceDocumentId: string;
        /** The record's latest attempt; a draft typed against another one is dropped. */
        draftBasis: string | null;
        initialData: NonNullable<SourceDocumentInputBaseProps["initialData"]>;
      }
  );

export type SourceDocumentInputInitialData = NonNullable<SourceDocumentInputProps["initialData"]>;
