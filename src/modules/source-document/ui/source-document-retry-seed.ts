import type { SourceDocumentInputInitialData } from "./source-document-input.types";
import type { SourceDocumentStoredFileDto } from "@/modules/source-document/contracts";
import { storedFileReadUrl } from "../stored-file-read";

export interface RetrySeedSourceDocument {
  id: string;
  text?: string | null;
  files?: SourceDocumentStoredFileDto[];
  documentDate?: string | null;
  hasImages?: boolean;
}

export interface RetrySeedInputData {
  text: string | null;
  files: SourceDocumentStoredFileDto[];
  documentDate: string | null;
}

export function buildSourceDocumentRetrySeed(
  sourceDocument: RetrySeedSourceDocument,
  inputData?: RetrySeedInputData
): SourceDocumentInputInitialData {
  const files = inputData?.files ?? sourceDocument.files ?? [];
  const text = inputData?.text ?? sourceDocument.text ?? undefined;
  const documentDate = inputData?.documentDate ?? sourceDocument.documentDate;

  return {
    images: files.map((file) => ({
      data: storedFileReadUrl(file.id),
      mimeType: file.contentType,
      storedFileId: file.id,
    })),
    ...(text != null ? { text } : {}),
    ...(documentDate != null ? { entryDate: documentDate } : {}),
  };
}
