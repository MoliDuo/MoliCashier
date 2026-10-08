import "server-only";
import { and, eq, exists } from "drizzle-orm";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { sourceDocumentFiles, storedFiles } from "@/persistence";
import { mapStoredFile } from "./shared";
import type { AuthorizedFileReadContract, StoredFileContract } from "./types";

/**
 * A file some document lists among its inputs. The document link
 * cascades away with its document, so the link is enough.
 */
async function findAuthorizedFile(fileId: string) {
  const rows = await db
    .select({ file: storedFiles })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.id, fileId),
        exists(
          db
            .select({ id: sourceDocumentFiles.id })
            .from(sourceDocumentFiles)
            .where(eq(sourceDocumentFiles.storedFileId, storedFiles.id))
        )
      )
    )
    .limit(1);
  return rows[0]?.file ?? null;
}

export async function readAuthorizedFile(
  fileId: string,
  options: { signal?: AbortSignal } = {}
): Promise<AuthorizedFileReadContract | null> {
  const row = await findAuthorizedFile(fileId);
  if (row == null) return null;
  const body = await getS3Storage().download(row.storageKey, options);
  return { file: mapStoredFile(row), body: new Uint8Array(body) };
}

export async function streamAuthorizedFile(
  fileId: string
): Promise<{ file: StoredFileContract; body: ReadableStream<Uint8Array> } | null> {
  const row = await findAuthorizedFile(fileId);
  if (row == null) return null;
  return { file: mapStoredFile(row), body: await getS3Storage().stream(row.storageKey) };
}
