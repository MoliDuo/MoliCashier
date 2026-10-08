import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SourceDocumentInputDto } from "@/modules/source-document/contracts";
import {
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { mapStoredFileDto } from "./mappers";

/** Read only the document's current input required to seed an edit-and-retry draft. */
export async function getSourceDocumentInput(
  sourceDocumentId: string
): Promise<SourceDocumentInputDto | null> {
  return db.transaction(
    async (tx) => {
      const document = await tx
        .select({
          id: sourceDocuments.id,
          processingStatus: extractionAttempts.status,
          documentDate: sourceDocuments.documentDate,
          createdAt: sourceDocuments.createdAt,
          text: sourceDocuments.inputText,
        })
        .from(sourceDocuments)
        .leftJoin(
          extractionAttempts,
          and(
            eq(extractionAttempts.sourceDocumentId, sourceDocuments.id),
            eq(extractionAttempts.id, sourceDocuments.latestAttemptId)
          )
        )
        .where(eq(sourceDocuments.id, sourceDocumentId))
        .limit(1)
        .then((rows) => rows[0]);
      if (document == null) return null;

      const files = await tx
        .select({
          id: storedFiles.id,
          contentType: storedFiles.contentType,
          byteSize: storedFiles.byteSize,
          originalFilename: storedFiles.originalFilename,
        })
        .from(sourceDocumentFiles)
        .innerJoin(storedFiles, eq(storedFiles.id, sourceDocumentFiles.storedFileId))
        .where(eq(sourceDocumentFiles.sourceDocumentId, sourceDocumentId))
        .orderBy(asc(sourceDocumentFiles.position));

      return {
        id: document.id,
        text: document.text,
        files: files.map(mapStoredFileDto),
        processingStatus: document.processingStatus,
        documentDate: document.documentDate,
        createdAt: document.createdAt.toISOString(),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
